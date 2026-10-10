// Restore module tests (web-jam-tools#1083, web-jam-back#1144). Runs the restore against an
// in-memory database and an injected Dropbox client, once per guard case. Nothing here
// touches a real database or the network.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { serializeDoc, type BackupManifest } from '#src/lib/backup-export.js';
import { BACKUP_ROOT } from '#src/lib/dropbox.js';
import {
  RestoreRefusal,
  registerDeclaredModels,
  replaceFromFolder,
  resetRestoreActive,
  restoreFromFolder,
  restoreProduction,
  runDateOf,
  verifyFolderCounts,
  type RestoreDbLike,
  type RestoreDropboxLike,
  type RestoreProductionOptions,
} from '#src/model/backup/backup-restore.js';

type Doc = Record<string, unknown>;

// An in-memory Db: collections of documents, plus the index names each collection holds.
class FakeDb implements RestoreDbLike {
  data: Record<string, Doc[]>;

  indexes: Record<string, string[]>;

  calls: string[] = [];

  dropError?: Error;

  constructor(data: Record<string, Doc[]> = {}, indexes: Record<string, string[]> = {}) {
    this.data = data;
    this.indexes = indexes;
  }

  listCollections() {
    return { toArray: () => Promise.resolve(Object.keys(this.data).map((name) => ({ name }))) };
  }

  collection(name: string) {
    return {
      insertMany: (docs: Doc[]) => {
        this.calls.push(`insert ${name} ${docs.length}`);
        if (!this.data[name]) {
          this.data[name] = [];
          this.indexes[name] = ['_id_'];
        }
        this.data[name].push(...docs);
        return Promise.resolve({ insertedCount: docs.length });
      },
      indexes: () => {
        if (!this.data[name]) return Promise.reject(Object.assign(new Error('ns does not exist'), { code: 26 }));
        return Promise.resolve((this.indexes[name] || ['_id_']).map((n) => ({ name: n })));
      },
    };
  }

  dropCollection(name: string) {
    this.calls.push(`drop ${name}`);
    if (this.dropError) return Promise.reject(this.dropError);
    if (!this.data[name]) return Promise.reject(Object.assign(new Error('ns not found'), { code: 26 }));
    delete this.data[name];
    delete this.indexes[name];
    return Promise.resolve(true);
  }

  // Writes only: a refused restore leaves this empty.
  changes(): string[] {
    return this.calls.filter((c) => c.startsWith('drop') || c.startsWith('insert'));
  }
}

const RUN = '2026-10-08T12-00-00-000Z';
const RUN_DATE = '2026-10-08';
const FRESH = '2026-10-10T12-00-00-000Z';

const SONGS: Doc[] = [{ title: 'one' }, { title: 'two' }, { title: 'three' }];
const USERS: Doc[] = [{ name: 'josh' }];

function manifestOf(collections: Record<string, number>, ok = true): BackupManifest {
  return {
    startedAt: '2026-10-08T12:00:00.000Z',
    finishedAt: '2026-10-08T12:01:00.000Z',
    trigger: 'daily check',
    generatedAt: '2026-10-08T12:00:00.000Z',
    databases: { webjamsalem: { ok, collections } },
  };
}

const ndjson = (docs: Doc[]) => Buffer.from(docs.map((d) => `${serializeDoc(d)}\n`).join(''));

interface Setup {
  client: RestoreDropboxLike;
  manifests: Record<string, BackupManifest | null | Error>;
  files: Record<string, Buffer | Error>;
  opts: RestoreProductionOptions;
  takeFreshBackup: ReturnType<typeof vi.fn>;
  rebuildIndexes: ReturnType<typeof vi.fn>;
  db: FakeDb;
}

function setup(db: FakeDb = new FakeDb({ song: [{ title: 'live' }], user: [{ name: 'live' }], extra: [{ keep: true }] })): Setup {
  const manifests: Record<string, BackupManifest | null | Error> = {
    [RUN]: manifestOf({ song: 3, user: 1 }),
    [FRESH]: manifestOf({ song: 1, user: 1, extra: 1 }),
  };
  const files: Record<string, Buffer | Error> = {
    [`${BACKUP_ROOT}/${RUN}/webjamsalem/song.ndjson`]: ndjson(SONGS),
    [`${BACKUP_ROOT}/${RUN}/webjamsalem/user.ndjson`]: ndjson(USERS),
  };
  const client: RestoreDropboxLike = {
    getAccessToken: () => Promise.resolve('token'),
    readManifest: (_t, label) => {
      const m = manifests[label];
      if (m instanceof Error) return Promise.reject(m);
      return Promise.resolve(m ?? null);
    },
    downloadFile: (_t, p) => {
      const f = files[p];
      if (f instanceof Error) return Promise.reject(f);
      return Promise.resolve(f ?? null);
    },
  };
  const takeFreshBackup = vi.fn(() => Promise.resolve(manifestOf({})));
  const rebuildIndexes = vi.fn(() => Promise.resolve());
  const opts: RestoreProductionOptions = {
    runName: RUN,
    typedDate: RUN_DATE,
    dropboxClient: client,
    db,
    takeFreshBackup,
    freshBackupLabel: FRESH,
    rebuildIndexes,
    scratchDir: fs.mkdtempSync(path.join(os.tmpdir(), 'restore-spec-scratch-')),
  };
  return { client, manifests, files, opts, takeFreshBackup, rebuildIndexes, db };
}

async function refusal(promise: Promise<unknown>): Promise<RestoreRefusal> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(RestoreRefusal);
    return e as RestoreRefusal;
  }
  throw new Error('expected the restore to refuse');
}

describe('backup-restore.ts: restoreProduction guards', () => {
  beforeEach(() => resetRestoreActive());

  describe('guard 1: only a good run can be chosen', () => {
    it('proceeds for a good run', async () => {
      const s = setup();
      const result = await restoreProduction(s.opts);
      expect(result.collections.map((c) => c.collection).sort()).toEqual(['song', 'user']);
    });

    it('refuses an incomplete run (no manifest) and changes nothing', async () => {
      const s = setup();
      s.manifests[RUN] = null;
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('run');
      expect(s.db.changes()).toEqual([]);
      expect(s.takeFreshBackup).not.toHaveBeenCalled();
    });

    it('refuses a failed run and changes nothing', async () => {
      const s = setup();
      s.manifests[RUN] = manifestOf({ song: 3, user: 1 }, false);
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('run');
      expect(s.db.changes()).toEqual([]);
    });

    it('refuses when the manifest cannot be read', async () => {
      const s = setup();
      s.manifests[RUN] = new Error('409 restricted_content');
      const r = await refusal(restoreProduction(s.opts));
      expect(r.guard).toBe('run');
      expect(r.message).toContain('restricted_content');
      expect(s.db.changes()).toEqual([]);
    });

    it('uses the default Dropbox token call when the client has none', async () => {
      const s = setup();
      delete s.client.getAccessToken;
      s.manifests[RUN] = null;
      // dropbox.getAccessToken() cannot succeed here without settings: it rejects, so the restore fails
      // closed before changing anything.
      await expect(restoreProduction(s.opts)).rejects.toBeInstanceOf(Error);
      expect(s.db.changes()).toEqual([]);
    });
  });

  describe('guard 2: the typed date must match the chosen run', () => {
    it('proceeds when the typed date matches', async () => {
      const s = setup();
      s.opts.typedDate = ` ${RUN_DATE} `;
      await expect(restoreProduction(s.opts)).resolves.toBeDefined();
    });

    it('refuses a wrong date and changes nothing', async () => {
      const s = setup();
      s.opts.typedDate = '2026-10-09';
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('date');
      expect(s.db.changes()).toEqual([]);
      expect(s.takeFreshBackup).not.toHaveBeenCalled();
    });

    it('refuses when the run date cannot be determined', async () => {
      const s = setup();
      s.opts.runName = 'not-a-date';
      s.manifests['not-a-date'] = manifestOf({ song: 3 });
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('date');
      expect(s.db.changes()).toEqual([]);
    });

    it('reads the run date from the folder name', () => {
      expect(runDateOf(RUN)).toBe(RUN_DATE);
      expect(runDateOf('garbage')).toBeNull();
    });
  });

  describe('guard 3: a fresh backup of production is taken first', () => {
    it('proceeds when the fresh backup succeeds and reads back good', async () => {
      const s = setup();
      await restoreProduction(s.opts);
      expect(s.takeFreshBackup).toHaveBeenCalledTimes(1);
    });

    it('refuses when the fresh backup fails, changing nothing', async () => {
      const s = setup();
      s.takeFreshBackup.mockRejectedValue(new Error('export failed: disk full'));
      const r = await refusal(restoreProduction(s.opts));
      expect(r.guard).toBe('fresh backup');
      expect(r.message).toContain('disk full');
      expect(s.db.changes()).toEqual([]);
    });

    it('refuses when the fresh backup cannot be read back', async () => {
      const s = setup();
      s.manifests[FRESH] = new Error('dropbox down');
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('fresh backup');
      expect(s.db.changes()).toEqual([]);
    });

    it('refuses when the fresh backup reads back as not good', async () => {
      const s = setup();
      s.manifests[FRESH] = null;
      expect((await refusal(restoreProduction(s.opts))).message).toContain('not read back as a good run');
      expect(s.db.changes()).toEqual([]);
    });

    it('downloads the chosen run before the fresh backup can prune it', async () => {
      const s = setup();
      const order: string[] = [];
      const download = s.client.downloadFile!;
      s.client.downloadFile = (t, p) => { order.push('download'); return download(t, p); };
      s.takeFreshBackup.mockImplementation(() => { order.push('fresh'); return Promise.resolve(manifestOf({})); });
      await restoreProduction(s.opts);
      expect(order[0]).toBe('download');
      expect(order[order.length - 1]).toBe('fresh');
    });
  });

  describe('guard 4: the files are checked against the manifest', () => {
    it('proceeds when every count matches', async () => {
      const s = setup();
      await expect(restoreProduction(s.opts)).resolves.toBeDefined();
    });

    it('refuses a file whose count differs, changing nothing', async () => {
      const s = setup();
      s.files[`${BACKUP_ROOT}/${RUN}/webjamsalem/song.ndjson`] = ndjson(SONGS.slice(0, 2));
      const r = await refusal(restoreProduction(s.opts));
      expect(r.guard).toBe('files');
      expect(r.message).toContain('holds 2 records but the manifest says 3');
      expect(s.db.changes()).toEqual([]);
      expect(s.takeFreshBackup).not.toHaveBeenCalled();
    });

    it('refuses when a file is missing from the run', async () => {
      const s = setup();
      delete s.files[`${BACKUP_ROOT}/${RUN}/webjamsalem/user.ndjson`];
      expect((await refusal(restoreProduction(s.opts))).message).toContain('missing from');
      expect(s.db.changes()).toEqual([]);
    });

    it('refuses when a file cannot be downloaded', async () => {
      const s = setup();
      s.files[`${BACKUP_ROOT}/${RUN}/webjamsalem/user.ndjson`] = new Error('timeout');
      expect((await refusal(restoreProduction(s.opts))).message).toContain('timeout');
      expect(s.db.changes()).toEqual([]);
    });

    it('refuses when the manifest lists no webjamsalem collections', async () => {
      const s = setup();
      s.manifests[RUN] = { ...manifestOf({}), databases: { other: { ok: true, collections: {} } } };
      expect((await refusal(restoreProduction(s.opts))).guard).toBe('files');
    });

    it('refuses when the client cannot download files', async () => {
      const s = setup();
      delete s.client.downloadFile;
      expect((await refusal(restoreProduction(s.opts))).message).toContain('cannot download');
      expect(s.db.changes()).toEqual([]);
    });

    it('cleans up the scratch folder whether or not the restore proceeds', async () => {
      const ok = setup();
      await restoreProduction(ok.opts);
      expect(fs.existsSync(ok.opts.scratchDir!)).toBe(false);
      const bad = setup();
      bad.opts.typedDate = 'wrong';
      await refusal(restoreProduction(bad.opts));
      expect(fs.existsSync(bad.opts.scratchDir!)).toBe(false);
    });
  });

  describe('the replacement', () => {
    it('replaces each backed-up collection, leaves absent ones alone, and reports counts side by side', async () => {
      const s = setup();
      const result = await restoreProduction(s.opts);
      expect(s.db.data.song).toEqual(SONGS);
      expect(s.db.data.user).toEqual(USERS);
      expect(s.db.data.extra).toEqual([{ keep: true }]);
      expect(result.collections).toEqual([
        { collection: 'song', restored: 3, manifest: 3 },
        { collection: 'user', restored: 1, manifest: 1 },
      ]);
      expect(s.db.changes()).toEqual(['drop song', 'insert song 3', 'drop user', 'insert user 1']);
      expect(s.rebuildIndexes).toHaveBeenCalledWith(['song', 'user']);
    });

    it('reports progress through each step', async () => {
      const s = setup();
      const steps: string[] = [];
      s.opts.onProgress = (step) => steps.push(step);
      await restoreProduction(s.opts);
      expect(steps).toEqual([
        'checking the chosen run',
        'checking the typed date',
        'downloading and checking the run files',
        'taking a fresh backup of production',
        'replacing collections',
        'rebuilding indexes',
      ]);
    });

    it('lists an index present before and absent after', async () => {
      const db = new FakeDb(
        { song: [{ title: 'live' }], user: [{ name: 'live' }] },
        { song: ['_id_', 'title_1', 'by_hand_1'], user: ['_id_'] },
      );
      const s = setup(db);
      // The record definitions declare title_1 only; the hand-made index is not re-created.
      s.opts.rebuildIndexes = () => {
        db.indexes.song = ['_id_', 'title_1'];
        return Promise.resolve();
      };
      const result = await restoreProduction(s.opts);
      expect(result.missingIndexes).toEqual([{ collection: 'song', index: 'by_hand_1' }]);
    });

    it('lists nothing when every index is rebuilt', async () => {
      const db = new FakeDb({ song: [{ title: 'live' }] }, { song: ['_id_', 'title_1'] });
      const s = setup(db);
      s.opts.rebuildIndexes = () => {
        db.indexes.song = ['_id_', 'title_1'];
        db.data.user = [{ name: 'restored' }];
        db.indexes.user = ['_id_'];
        return Promise.resolve();
      };
      expect((await restoreProduction(s.opts)).missingIndexes).toEqual([]);
    });

    it('reports a declared index that could not be built, without hiding the restored counts', async () => {
      const s = setup();
      s.opts.rebuildIndexes = () => Promise.resolve([{ collection: 'song', message: 'E11000 duplicate key url_1' }]);
      const result = await restoreProduction(s.opts);
      expect(result.indexFailures).toEqual([{ collection: 'song', message: 'E11000 duplicate key url_1' }]);
      expect(result.collections).toEqual([
        { collection: 'song', restored: 3, manifest: 3 },
        { collection: 'user', restored: 1, manifest: 1 },
      ]);
    });

    it('reports no index failures when the rebuilder reports none', async () => {
      const s = setup();
      expect((await restoreProduction(s.opts)).indexFailures).toEqual([]);
    });

    it('works without an index rebuilder', async () => {
      const s = setup();
      delete s.opts.rebuildIndexes;
      await expect(restoreProduction(s.opts)).resolves.toBeDefined();
    });
  });

  describe('one restore at a time', () => {
    it('refuses a second restore while one runs, and frees the slot afterward', async () => {
      const s = setup();
      let release: () => void = () => undefined;
      s.takeFreshBackup.mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(manifestOf({}));
      }));
      const first = restoreProduction(s.opts);
      await vi.waitFor(() => expect(s.takeFreshBackup).toHaveBeenCalled());

      const second = setup();
      expect((await refusal(restoreProduction(second.opts))).guard).toBe('in progress');
      release();
      await first;

      await expect(restoreProduction(setup().opts)).resolves.toBeDefined();
    });

    it('frees the slot after a refusal', async () => {
      const s = setup();
      s.opts.typedDate = 'wrong';
      await refusal(restoreProduction(s.opts));
      await expect(restoreProduction(setup().opts)).resolves.toBeDefined();
    });
  });
});

describe('backup-restore.ts: replaceFromFolder and restoreFromFolder', () => {
  let folder: string;

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-spec-folder-'));
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  const write = (name: string, docs: Doc[]) => fs.writeFileSync(path.join(folder, `${name}.ndjson`), ndjson(docs));

  it('checks the files against the manifest counts before replacing anything', async () => {
    write('song', SONGS);
    const db = new FakeDb({ song: [{ title: 'live' }] });
    const r = await restoreFromFolder({ db, folder, manifestCounts: { song: 99 } }).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(RestoreRefusal);
    expect(db.changes()).toEqual([]);
    expect(db.data.song).toEqual([{ title: 'live' }]);
  });

  it('replaces without a manifest, reporting n/a for the manifest count', async () => {
    write('song', SONGS);
    const result = await restoreFromFolder({ db: new FakeDb(), folder });
    expect(result.collections).toEqual([{ collection: 'song', restored: 3, manifest: null }]);
  });

  it('refuses when a manifest file is unreadable', async () => {
    await expect(verifyFolderCounts(folder, { song: 1 })).rejects.toBeInstanceOf(RestoreRefusal);
  });

  it('inserts large collections in batches', async () => {
    write('song', Array.from({ length: 2500 }, (_v, i) => ({ n: i })));
    const db = new FakeDb();
    const result = await replaceFromFolder({ db, folder });
    expect(result.collections).toEqual([{ collection: 'song', restored: 2500, manifest: null }]);
    expect(db.calls.filter((c) => c.startsWith('insert'))).toEqual(['insert song 1000', 'insert song 1000', 'insert song 500']);
  });

  it('replaces a collection with an empty one when its file is empty', async () => {
    write('song', []);
    const db = new FakeDb({ song: [{ title: 'live' }] });
    const result = await replaceFromFolder({ db, folder });
    expect(result.collections).toEqual([{ collection: 'song', restored: 0, manifest: null }]);
    expect(db.calls).toContain('drop song');
    expect(db.data.song).toBeUndefined();
  });

  it('ignores files that are not .ndjson and blank lines', async () => {
    fs.writeFileSync(path.join(folder, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(folder, 'song.ndjson'), `${serializeDoc({ a: 1 })}\n\n  \n${serializeDoc({ a: 2 })}\n`);
    const result = await replaceFromFolder({ db: new FakeDb(), folder });
    expect(result.collections).toEqual([{ collection: 'song', restored: 2, manifest: null }]);
  });

  it('applies a transform: keeps, drops and redirects, touching only collections that resolve', async () => {
    write('gigs', [{ g: 1 }, { g: 2 }]);
    write('book', [{ type: 'keep' }, { type: 'drop' }]);
    const db = new FakeDb({ gigs: [{ old: true }], book: [{ untouched: true }] });
    const result = await replaceFromFolder({
      db,
      folder,
      transform: (doc, name) => {
        if (name === 'gigs') return { ...doc, artist: 'josh' };
        return doc.type === 'keep' ? { collection: 'jamPics', doc } : null;
      },
    });
    expect(db.data.gigs).toEqual([{ g: 1, artist: 'josh' }, { g: 2, artist: 'josh' }]);
    expect(db.data.jamPics).toEqual([{ type: 'keep' }]);
    expect(db.data.book).toEqual([{ untouched: true }]); // every doc was redirected or dropped: never touched
    expect(result.collections.map((c) => c.collection).sort()).toEqual(['gigs', 'jamPics']);
  });

  it('refuses a malformed later record before dropping anything', async () => {
    fs.writeFileSync(path.join(folder, 'song.ndjson'), `${serializeDoc({ title: 'ok' })}\n{not json\n`);
    const db = new FakeDb({ song: [{ title: 'live' }] });
    const err = await refusal(replaceFromFolder({ db, folder }));
    expect(err.guard).toBe('files');
    expect(err.message).toMatch(/song\.ndjson.*record 2/);
    expect(db.changes()).toEqual([]);
    expect(db.data.song).toEqual([{ title: 'live' }]);
  });

  it('refuses a malformed record in a later collection before replacing an earlier one', async () => {
    write('song', SONGS);
    fs.writeFileSync(path.join(folder, 'user.ndjson'), '{not json\n');
    const db = new FakeDb({ song: [{ title: 'live' }], user: [{ name: 'live' }] });
    expect((await refusal(replaceFromFolder({ db, folder }))).guard).toBe('files');
    expect(db.changes()).toEqual([]);
    expect(db.data.song).toEqual([{ title: 'live' }]);
  });

  it.each(['null', '42', '"text"', '[1,2]', 'true'])('refuses a later record that is %s, not a document, before dropping anything', async (record) => {
    fs.writeFileSync(path.join(folder, 'song.ndjson'), `${serializeDoc({ title: 'ok' })}\n${record}\n`);
    const db = new FakeDb({ song: [{ title: 'live' }] });
    const err = await refusal(replaceFromFolder({ db, folder, manifestCounts: { song: 2 } }));
    expect(err.guard).toBe('files');
    expect(err.message).toMatch(/song\.ndjson.*record 2.*not a document/);
    expect(db.changes()).toEqual([]);
    expect(db.data.song).toEqual([{ title: 'live' }]);
  });

  it('refuses a file holding only null', async () => {
    fs.writeFileSync(path.join(folder, 'song.ndjson'), 'null\n');
    const db = new FakeDb({ song: [{ title: 'live' }] });
    expect((await refusal(replaceFromFolder({ db, folder }))).guard).toBe('files');
    expect(db.changes()).toEqual([]);
  });

  it('refuses a non-document record in a later collection before replacing an earlier one', async () => {
    write('song', SONGS);
    fs.writeFileSync(path.join(folder, 'user.ndjson'), `${serializeDoc({ name: 'ok' })}\nnull\n`);
    const db = new FakeDb({ song: [{ title: 'live' }], user: [{ name: 'live' }] });
    expect((await refusal(replaceFromFolder({ db, folder }))).guard).toBe('files');
    expect(db.changes()).toEqual([]);
    expect(db.data.song).toEqual([{ title: 'live' }]);
    expect(db.data.user).toEqual([{ name: 'live' }]);
  });

  it('inserts an ordinary document with doc and collection fields whole, into its own collection', async () => {
    const odd = { doc: { a: 1 }, collection: 'untouched', note: 'ordinary' };
    write('source', [odd]);
    const db = new FakeDb({ untouched: [{ keep: true }] });
    const result = await replaceFromFolder({ db, folder, manifestCounts: { source: 1 } });
    expect(db.data.source).toEqual([odd]);
    expect(db.data.untouched).toEqual([{ keep: true }]);
    expect(result.collections).toEqual([{ collection: 'source', restored: 1, manifest: 1 }]);
  });

  it('does not turn a failed drop into a merge', async () => {
    write('song', SONGS);
    const db = new FakeDb({ song: [{ title: 'live' }] });
    db.dropError = new Error('not authorized');
    await expect(replaceFromFolder({ db, folder })).rejects.toThrow('not authorized');
    expect(db.data.song).toEqual([{ title: 'live' }]);
  });

  it('treats a collection that does not exist yet as droppable', async () => {
    write('song', SONGS);
    const db = new FakeDb();
    db.dropError = Object.assign(new Error('anything'), { codeName: 'NamespaceNotFound' });
    await expect(replaceFromFolder({ db, folder })).resolves.toBeDefined();
    expect(db.data.song).toEqual(SONGS);
  });
});

describe('backup-restore.ts: registerDeclaredModels', () => {
  it('imports every *-schema module under the root, and nothing else', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-spec-models-'));
    fs.mkdirSync(path.join(root, 'nested'));
    const g = globalThis as Record<string, unknown>;
    g.__restoreSpecLoaded = [];
    const mark = (name: string) => `globalThis.__restoreSpecLoaded.push('${name}');\n`;
    fs.writeFileSync(path.join(root, 'a-schema.js'), mark('a'));
    fs.writeFileSync(path.join(root, 'nested', 'b-schema.js'), mark('b'));
    fs.writeFileSync(path.join(root, 'nested', 'c-controller.js'), mark('c'));
    fs.writeFileSync(path.join(root, 'nested', 'd-schema.d.ts'), '');
    await registerDeclaredModels(root);
    expect((g.__restoreSpecLoaded as string[]).sort()).toEqual(['a', 'b']);
    delete g.__restoreSpecLoaded;
    fs.rmSync(root, { recursive: true, force: true });
  });
});

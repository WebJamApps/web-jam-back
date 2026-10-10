// Copy-to-DEV tests (web-jam-tools#1083, web-jam-back#1146). Runs the copy against an in-memory DEV
// database and an injected Dropbox client, once per guard outcome. Nothing here touches a real
// database or the network.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { serializeDoc, type BackupManifest } from '#src/lib/backup-export.js';
import { BACKUP_ROOT } from '#src/lib/dropbox.js';
import { RestoreRefusal, type RestoreDropboxLike } from '#src/model/backup/backup-restore.js';
import {
  DEV_ASLEEP,
  checkDevTarget,
  copyToDev,
  isCopyActive,
  resetCopyActive,
  type ConnectDev,
  type CopyToDevOptions,
  type DevConnection,
  type DevDbLike,
} from '#src/model/backup/copy-to-dev.js';

type Doc = Record<string, unknown>;

const PROD = 'mongodb+srv://prod-cluster.mongodb.net/webjamsalem?retryWrites=true';
const DEV = 'mongodb+srv://dev-cluster.mongodb.net/web-jam-dev?retryWrites=true';
const RUN = '2026-10-08T12-00-00-000Z';

class FakeDev implements DevDbLike {
  data: Record<string, Doc[]>;

  calls: string[] = [];

  pingError?: Error;

  // Set to make every read after the first write fail, as a connection lost mid-copy would.
  readError?: Error;

  constructor(data: Record<string, Doc[]> = {}) {
    this.data = data;
  }

  listCollections() {
    return { toArray: () => Promise.resolve(Object.keys(this.data).map((name) => ({ name }))) };
  }

  collection(name: string) {
    return {
      insertMany: (docs: Doc[]) => {
        this.calls.push(`insert ${name} ${docs.length}`);
        if (!this.data[name]) this.data[name] = [];
        this.data[name].push(...docs);
        return Promise.resolve({ insertedCount: docs.length });
      },
      indexes: () => Promise.resolve([{ name: '_id_' }]),
      find: (): AsyncIterable<Doc> => {
        const docs = this.data[name] || [];
        const failure = this.readError && this.writes().length > 0 ? this.readError : undefined;
        return (async function* iterate() {
          if (failure) throw failure;
          yield* docs;
        }());
      },
    };
  }

  dropCollection(name: string) {
    this.calls.push(`drop ${name}`);
    if (!this.data[name]) return Promise.reject(Object.assign(new Error('ns not found'), { code: 26 }));
    delete this.data[name];
    return Promise.resolve(true);
  }

  command() {
    this.calls.push('ping');
    return this.pingError ? Promise.reject(this.pingError) : Promise.resolve({ ok: 1 });
  }

  writes(): string[] {
    return this.calls.filter((c) => c.startsWith('drop') || c.startsWith('insert'));
  }
}

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

const USERS: Doc[] = [
  { _id: 'u1', email: 'dev@band.example', userType: 'Developer', name: 'Dev' },
  { _id: 'u2', email: 'member@band.example', userType: 'Member', note: 'cc member@band.example and x@y.example' },
];
const VENUES: Doc[] = [
  { _id: 'v1', name: 'Hall', contact: 'Booking <book@hall.example>', pay: 100 },
  { _id: 'v2', name: 'Pub', contact: 'none' },
  { _id: 'v3', doc: { a: 1 }, collection: 'untouched', note: 'an ordinary record with doc and collection fields' },
];
const TOKENS: Doc[] = [{ _id: 't1', pageId: 'p1', value: 'EAAB-page-token' }];

interface Setup {
  opts: CopyToDevOptions;
  dev: FakeDev;
  connect: ReturnType<typeof vi.fn>;
  manifests: Record<string, BackupManifest | null | Error>;
  files: Record<string, Buffer | Error>;
  closed: () => number;
}

function setup(dev: FakeDev = new FakeDev({ users: [{ old: true }], untouched: [{ keep: true }] })): Setup {
  const manifests: Record<string, BackupManifest | null | Error> = {
    [RUN]: manifestOf({ users: USERS.length, venues: VENUES.length, facebooktokens: TOKENS.length }),
  };
  const files: Record<string, Buffer | Error> = {
    [`${BACKUP_ROOT}/${RUN}/webjamsalem/users.ndjson`]: ndjson(USERS),
    [`${BACKUP_ROOT}/${RUN}/webjamsalem/venues.ndjson`]: ndjson(VENUES),
    [`${BACKUP_ROOT}/${RUN}/webjamsalem/facebooktokens.ndjson`]: ndjson(TOKENS),
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
  let closes = 0;
  const connect = vi.fn((): Promise<DevConnection> => Promise.resolve({
    db: dev,
    close: () => { closes += 1; return Promise.resolve(); },
  }));
  const opts: CopyToDevOptions = {
    runName: RUN,
    dropboxClient: client,
    devUri: DEV,
    productionUri: PROD,
    connect: connect as unknown as ConnectDev,
    scratchDir: fs.mkdtempSync(path.join(os.tmpdir(), 'copy-to-dev-spec-')),
    timeoutMs: 50,
  };
  return {
    opts, dev, connect, manifests, files, closed: () => closes,
  };
}

async function refusal(promise: Promise<unknown>): Promise<RestoreRefusal> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(RestoreRefusal);
    return e as RestoreRefusal;
  }
  throw new Error('expected the copy to refuse');
}

afterEach(() => { resetCopyActive(); });

describe('copy-to-dev: the setting', () => {
  it('proceeds when the setting is present and names a DEV database on another host', () => {
    expect(() => checkDevTarget(DEV, PROD)).not.toThrow();
  });

  it('refuses when the setting is absent, and names the setting', async () => {
    const s = setup();
    s.opts.devUri = undefined;
    const prior = process.env.DEV_MONGO_DB_URI;
    delete process.env.DEV_MONGO_DB_URI;
    try {
      const err = await refusal(copyToDev(s.opts));
      expect(err.message).toMatch(/DEV_MONGO_DB_URI is not set/);
    } finally {
      if (prior !== undefined) process.env.DEV_MONGO_DB_URI = prior;
    }
    expect(s.dev.writes()).toEqual([]);
  });

  it.each(['', '   ', 'not a uri', 'mongodb://', 'http://dev-cluster.example/web-jam-dev'])('refuses a setting that is %j', (uri) => {
    expect(() => checkDevTarget(uri, PROD)).toThrow(RestoreRefusal);
  });

  it('refuses a setting whose database name cannot be decoded', () => {
    expect(() => checkDevTarget('mongodb://h/db%ZZdev', PROD)).toThrow(/cannot be parsed/);
  });
});

describe('copy-to-dev: the database name', () => {
  it('proceeds when the name contains dev, in any case', () => {
    expect(() => checkDevTarget('mongodb://dev-host:27017/My-DEV-db', PROD)).not.toThrow();
  });

  it('refuses when the name does not contain dev', () => {
    expect(() => checkDevTarget('mongodb://dev-host/webjamsalem', PROD)).toThrow(/does not contain "dev"/);
  });

  it('refuses when the name cannot be determined', () => {
    expect(() => checkDevTarget('mongodb://dev-host', PROD)).toThrow(/cannot be determined/);
    expect(() => checkDevTarget('mongodb://dev-host/?retryWrites=true', PROD)).toThrow(/cannot be determined/);
  });
});

describe("copy-to-dev: production's host", () => {
  it('proceeds when the hosts differ', () => {
    expect(() => checkDevTarget(DEV, PROD)).not.toThrow();
  });

  it("refuses when the host equals production's, however it is written", () => {
    expect(() => checkDevTarget('mongodb+srv://PROD-cluster.mongodb.net/web-jam-dev', PROD)).toThrow(/production's host/);
    expect(() => checkDevTarget('mongodb://a:27017,prod-cluster.mongodb.net:27017/web-jam-dev', PROD)).toThrow(/production's host/);
  });

  it("refuses when production's host cannot be determined", () => {
    expect(() => checkDevTarget(DEV, undefined)).toThrow(/cannot be determined/);
    expect(() => checkDevTarget(DEV, 'garbage')).toThrow(/cannot be determined/);
  });

  it('refuses through the whole copy with nothing changed', async () => {
    const s = setup();
    s.opts.productionUri = DEV;
    expect((await refusal(copyToDev(s.opts))).guard).toBe('host');
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.dev.writes()).toEqual([]);
  });
});

describe('copy-to-dev: the DEV cluster', () => {
  it('proceeds when the cluster answers', async () => {
    const s = setup();
    await expect(copyToDev(s.opts)).resolves.toBeDefined();
    expect(s.dev.calls[0]).toBe('ping');
  });

  it('refuses with the asleep message when the cluster cannot be reached', async () => {
    const s = setup();
    s.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await refusal(copyToDev(s.opts));
    expect(err.message).toBe(DEV_ASLEEP);
    expect(err.message).toMatch(/Resume/);
    expect(err.message).toMatch(/Atlas/);
    expect(s.dev.writes()).toEqual([]);
  });

  it('refuses with the same message when the ping fails, and closes the connection', async () => {
    const s = setup();
    s.dev.pingError = new Error('no primary');
    expect((await refusal(copyToDev(s.opts))).message).toBe(DEV_ASLEEP);
    expect(s.closed()).toBe(1);
    expect(s.dev.writes()).toEqual([]);
  });

  it('refuses with the same message when reachability cannot be determined (a timeout)', async () => {
    const s = setup();
    s.connect.mockImplementation(() => new Promise(() => undefined));
    expect((await refusal(copyToDev(s.opts))).message).toBe(DEV_ASLEEP);
    s.connect.mockImplementation(() => Promise.resolve({
      db: { command: () => new Promise(() => undefined) },
      close: () => Promise.resolve(),
    }));
    expect((await refusal(copyToDev(s.opts))).message).toBe(DEV_ASLEEP);
  });
});

describe("copy-to-dev: the chosen run's files", () => {
  it('refuses a run that is not good', async () => {
    const s = setup();
    s.manifests[RUN] = manifestOf({ users: 2 }, false);
    expect((await refusal(copyToDev(s.opts))).guard).toBe('run');
    expect(s.dev.writes()).toEqual([]);
  });

  it('refuses when a count differs from the manifest', async () => {
    const s = setup();
    s.manifests[RUN] = manifestOf({ users: 3, venues: VENUES.length, facebooktokens: TOKENS.length });
    expect((await refusal(copyToDev(s.opts))).guard).toBe('files');
    expect(s.dev.writes()).toEqual([]);
  });

  it('refuses when a file cannot be read', async () => {
    const s = setup();
    s.files[`${BACKUP_ROOT}/${RUN}/webjamsalem/venues.ndjson`] = new Error('Dropbox 500');
    expect((await refusal(copyToDev(s.opts))).guard).toBe('files');
    expect(s.dev.writes()).toEqual([]);
  });

  it('refuses a good run that holds no webjamsalem collections', async () => {
    const s = setup();
    s.manifests[RUN] = { ...manifestOf({}), databases: { webjamsalem: { ok: true } as never } };
    expect((await refusal(copyToDev(s.opts))).guard).toBe('files');
  });
});

describe('copy-to-dev: the copy', () => {
  it('copies every collection, replaces every address, and reports per-collection counts', async () => {
    const s = setup();
    const result = await copyToDev(s.opts);

    expect(s.dev.data.users).toEqual([
      {
        _id: 'u1', email: 'dev@band.example', userType: 'Developer', name: 'Dev',
      },
      {
        _id: 'u2',
        email: 'users-u2@example.invalid',
        userType: 'Member',
        note: 'cc users-u2@example.invalid and users-u2-2@example.invalid',
      },
    ]);
    expect(s.dev.data.venues[0].contact).toBe('Booking <venues-v1@example.invalid>');
    expect(s.dev.data.facebooktokens).toEqual([{ _id: 't1', pageId: 'p1', value: '' }]);
    expect(result.collections).toEqual([
      {
        collection: 'facebooktokens', copied: 1, manifest: 1, addressesReplaced: 0,
      },
      {
        collection: 'users', copied: 2, manifest: 2, addressesReplaced: 3,
      },
      {
        collection: 'venues', copied: 3, manifest: 3, addressesReplaced: 1,
      },
    ]);
  });

  it('inserts an ordinary record that has doc and collection fields whole, into its own collection', async () => {
    const s = setup();
    await copyToDev(s.opts);
    expect(s.dev.data.venues[2]).toEqual(VENUES[2]);
    expect(s.dev.data.untouched).toEqual([{ keep: true }]);
  });

  it('reports a clean copy when the read-back finds no real address other than the admin accounts own', async () => {
    const s = setup();
    const result = await copyToDev(s.opts);
    expect(result.readBack).toMatchObject({ status: 'none', remaining: 0 });
    expect(result.clean).toBe(true);
  });

  it('reports the count when the read-back finds a real address in a collection the copy left alone', async () => {
    const s = setup(new FakeDev({ untouched: [{ contact: 'real@venue.example', other: 'Also.Real@venue.example' }] }));
    const result = await copyToDev(s.opts);
    expect(result.readBack).toMatchObject({ status: 'found', remaining: 2 });
    expect(result.clean).toBe(false);
  });

  it('does not report the copy as clean when DEV cannot be read back', async () => {
    const s = setup();
    s.dev.readError = new Error('connection lost');
    const result = await copyToDev(s.opts);
    expect(result.readBack.status).toBe('failed');
    expect(result.readBack.message).toMatch(/connection lost/);
    expect(result.readBack.remaining).toBeNull();
    expect(result.clean).toBe(false);
  });

  it('closes the DEV connection, frees the slot and removes the scratch files after the copy', async () => {
    const s = setup();
    await copyToDev(s.opts);
    expect(s.closed()).toBe(1);
    expect(isCopyActive()).toBe(false);
    expect(fs.existsSync(s.opts.scratchDir as string)).toBe(false);
  });

  it('frees the slot after a refusal', async () => {
    const s = setup();
    s.manifests[RUN] = null;
    await refusal(copyToDev(s.opts));
    expect(isCopyActive()).toBe(false);
  });

  it('refuses a second copy while one runs', async () => {
    const s = setup();
    let release: () => void = () => undefined;
    s.connect.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ db: s.dev, close: () => Promise.resolve() });
    }));
    s.opts.timeoutMs = 5000;
    const first = copyToDev(s.opts);
    await vi.waitFor(() => expect(isCopyActive()).toBe(true));
    expect((await refusal(copyToDev(setup().opts))).guard).toBe('in progress');
    release();
    await first;
  });

  it('refuses a malformed record before dropping anything in DEV', async () => {
    const s = setup();
    s.files[`${BACKUP_ROOT}/${RUN}/webjamsalem/venues.ndjson`] = Buffer.from(
      `${serializeDoc(VENUES[0])}\n{not json\n${serializeDoc(VENUES[2])}\n`,
    );
    expect((await refusal(copyToDev(s.opts))).guard).toBe('files');
    expect(s.dev.writes()).toEqual([]);
  });

  it('rebuilds the indexes of the copied collections when the connection offers it', async () => {
    const s = setup();
    const rebuild = vi.fn(() => Promise.resolve([{ collection: 'users', message: 'dup' }]));
    s.connect.mockResolvedValue({ db: s.dev, close: () => Promise.resolve(), rebuildIndexes: rebuild });
    const result = await copyToDev(s.opts);
    expect(rebuild).toHaveBeenCalledWith(expect.arrayContaining(['users', 'venues', 'facebooktokens']));
    expect(result.indexFailures).toEqual([{ collection: 'users', message: 'dup' }]);
  });
});

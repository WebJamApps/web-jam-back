import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  performBackup,
  outputRoot,
  isBackupActive,
  resetActiveBackup,
  type DropboxClientLike,
} from '#src/model/backup/backup-controller.js';
import type { DbLike, BackupManifest } from '#src/lib/backup-export.js';
import { BACKUP_ROOT } from '#src/lib/dropbox.js';

const DEFAULT_COLLECTIONS: Record<string, Record<string, unknown>[]> = { user: [{ name: 'josh' }] };

function createFakeDb(collections: Record<string, Record<string, unknown>[]> = DEFAULT_COLLECTIONS): DbLike {
  return {
    listCollections: () => ({
      toArray: () => Promise.resolve(Object.keys(collections).map((name) => ({ name }))),
    }),
    collection: (name: string) => ({
      find: () => ({
        // eslint-disable-next-line @typescript-eslint/require-await
        [Symbol.asyncIterator]: async function* asyncIterator() {
          for (const doc of collections[name] || []) yield doc;
        },
      }),
    }),
  };
}

function createMockDropboxClient(overrides: Partial<DropboxClientLike> = {}): DropboxClientLike {
  const goodManifest: BackupManifest = {
    startedAt: '2026-10-08T12:00:00.000Z',
    finishedAt: '2026-10-08T12:01:00.000Z',
    trigger: 'backup button',
    generatedAt: '2026-10-08T12:00:00.000Z',
    databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
  };

  return {
    dropboxConfigured: vi.fn(() => true),
    getAccessToken: vi.fn(() => Promise.resolve('mock-access-token')),
    listSubfolders: vi.fn(() => Promise.resolve([])),
    readManifest: vi.fn(() => Promise.resolve(goodManifest)),
    uploadFile: vi.fn(() => Promise.resolve()),
    deletePath: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('backup-controller.ts: performBackup', () => {
  const originalEnv = { ...process.env };
  let testOutputDir: string;

  beforeEach(() => {
    resetActiveBackup();
    testOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-controller-test-'));
    process.env.BACKUP_OUTPUT_DIR = testOutputDir;
  });

  afterEach(() => {
    resetActiveBackup();
    fs.rmSync(testOutputDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uploads every file with manifest.json uploaded last when settings are present', async () => {
    const callOrder: string[] = [];
    const client = createMockDropboxClient({
      uploadFile: vi.fn((_token, dropboxPath) => {
        callOrder.push(`upload:${path.basename(dropboxPath)}`);
        return Promise.resolve();
      }),
      readManifest: vi.fn((_token, label) => {
        callOrder.push(`readManifest:${label}`);
        return Promise.resolve({
          startedAt: '2026-10-08T12:00:00.000Z',
          finishedAt: '2026-10-08T12:01:00.000Z',
          trigger: 'backup button',
          generatedAt: '2026-10-08T12:00:00.000Z',
          databases: { webjamsalem: { ok: true, collections: { user: 1, gigs: 1 } } },
        });
      }),
    });

    const db = createFakeDb({
      user: [{ name: 'josh' }],
      gigs: [{ venue: 'Bridge' }],
    });

    const manifest = await performBackup({
      dropboxClient: client,
      db,
      now: new Date('2026-10-08T12:00:00.000Z'),
    });

    expect(manifest.databases.webjamsalem.ok).toBe(true);

    // Verify upload calls
    const uploadCalls = (client.uploadFile as ReturnType<typeof vi.fn>).mock.calls as [string, string, Buffer][];
    expect(uploadCalls.length).toBe(3); // user.ndjson, gigs.ndjson, manifest.json

    const lastUploadCall = uploadCalls[uploadCalls.length - 1];
    expect(lastUploadCall[1]).toContain('manifest.json');

    // All data files must be uploaded before manifest.json
    const nonManifestCalls = uploadCalls.slice(0, -1);
    for (const c of nonManifestCalls) {
      expect(c[1]).not.toContain('manifest.json');
    }

    // Verify readManifest verification happens after manifest upload
    const manifestUploadIndex = callOrder.indexOf('upload:manifest.json');
    const readManifestIndex = callOrder.findIndex((entry) => entry.startsWith('readManifest:2026-10-08T12-00-00-000Z'));
    expect(manifestUploadIndex).toBeGreaterThan(-1);
    expect(readManifestIndex).toBeGreaterThan(manifestUploadIndex);
  });

  it('refuses, uploads nothing, and writes nothing to local disk when settings are absent', async () => {
    const client = createMockDropboxClient({
      dropboxConfigured: vi.fn(() => false),
    });

    await expect(performBackup({ dropboxClient: client, db: createFakeDb() })).rejects.toThrow(
      /Dropbox backup settings absent/i,
    );

    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
    expect(client.listSubfolders).not.toHaveBeenCalled();

    // Verify nothing was written to output directory
    const filesOnDisk = fs.readdirSync(outputRoot());
    expect(filesOnDisk).toHaveLength(0);
  });

  it('uploads nothing and deletes nothing when export fails', async () => {
    const client = createMockDropboxClient();
    const failingDb: DbLike = {
      listCollections: () => {
        throw new Error('Mongo connection dropped');
      },
      collection: () => ({
        find: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          [Symbol.asyncIterator]: async function* asyncIterator() {
            // empty
          },
        }),
      }),
    };

    await expect(performBackup({ dropboxClient: client, db: failingDb })).rejects.toThrow(
      /one or more databases failed export/i,
    );

    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();

    // Local export directory must be cleaned up
    const filesOnDisk = fs.readdirSync(outputRoot());
    expect(filesOnDisk).toHaveLength(0);
  });

  it('deletes only after a good run, removing good runs beyond 8 and incomplete folders over a day old', async () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const existingFolders = [
      '2026-10-01T00-00-00-000Z', // good 1 (oldest good -> 9th good run, beyond newest 8)
      '2026-10-02T00-00-00-000Z', // good 2
      '2026-10-03T00-00-00-000Z', // good 3
      '2026-10-04T00-00-00-000Z', // good 4
      '2026-10-05T00-00-00-000Z', // good 5
      '2026-10-06T00-00-00-000Z', // good 6
      '2026-10-07T00-00-00-000Z', // good 7
      '2026-10-08T00-00-00-000Z', // good 8
      '2026-10-07T10-00-00-000Z', // incomplete folder (26h old, > 24h) -> delete
      '2026-10-08T08-00-00-000Z', // incomplete folder (4h old, <= 24h) -> keep
    ];

    const goodManifest: BackupManifest = {
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:01:00.000Z',
      generatedAt: '2026-10-01T00:00:00.000Z',
      databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
    };

    const client = createMockDropboxClient({
      listSubfolders: vi.fn((_token, _path) => Promise.resolve([...existingFolders, '2026-10-08T12-00-00-000Z'])),
      readManifest: vi.fn((_token, label) => {
        if (label === '2026-10-07T10-00-00-000Z' || label === '2026-10-08T08-00-00-000Z') {
          return Promise.resolve(null); // incomplete
        }
        return Promise.resolve(goodManifest);
      }),
    });

    await performBackup({
      dropboxClient: client,
      db: createFakeDb(),
      now,
    });

    const deletedPaths = ((client.deletePath as ReturnType<typeof vi.fn>).mock.calls as [string, string][]).map(
      (c) => c[1],
    );

    // Oldest good run (beyond newest 8) must be deleted
    expect(deletedPaths).toContain(`${BACKUP_ROOT}/2026-10-01T00-00-00-000Z`);
    // Incomplete folder over 24h old must be deleted
    expect(deletedPaths).toContain(`${BACKUP_ROOT}/2026-10-07T10-00-00-000Z`);
    // Incomplete folder under 24h old must NOT be deleted
    expect(deletedPaths).not.toContain(`${BACKUP_ROOT}/2026-10-08T08-00-00-000Z`);
    // Newer good runs must NOT be deleted
    expect(deletedPaths).not.toContain(`${BACKUP_ROOT}/2026-10-02T00-00-00-000Z`);
    expect(deletedPaths).not.toContain(`${BACKUP_ROOT}/2026-10-08T00-00-00-000Z`);
  });

  it('refuses to delete anything when the manifest cannot be read back', async () => {
    const client = createMockDropboxClient({
      // readManifest returns null for the uploaded run
      readManifest: vi.fn(() => Promise.resolve(null)),
      listSubfolders: vi.fn(() => Promise.resolve(['2026-10-01T00-00-00-000Z'])),
    });

    await performBackup({ dropboxClient: client, db: createFakeDb() });

    expect(client.uploadFile).toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
  });

  it('refuses to delete anything when Dropbox returns an error reading back the manifest', async () => {
    const client = createMockDropboxClient({
      readManifest: vi.fn(() => Promise.reject(new Error('Dropbox 500 Internal Error'))),
    });

    await performBackup({ dropboxClient: client, db: createFakeDb() });

    expect(client.uploadFile).toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
  });

  it('refuses to start when a run folder less than ten minutes old has no manifest', async () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    // Folder created 4 minutes ago
    const inProgressFolder = '2026-10-08T11-56-00-000Z';

    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.resolve([inProgressFolder])),
      readManifest: vi.fn((_token, label) => {
        if (label === inProgressFolder) return Promise.resolve(null); // no manifest
        return Promise.resolve(null);
      }),
    });

    await expect(performBackup({ dropboxClient: client, db: createFakeDb(), now })).rejects.toThrow(
      /backup run in progress: folder 2026-10-08T11-56-00-000Z has no manifest/i,
    );

    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
  });

  it('refuses to start when run folders cannot be listed', async () => {
    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.reject(new Error('Dropbox listing error 500'))),
    });

    await expect(performBackup({ dropboxClient: client, db: createFakeDb() })).rejects.toThrow(
      /failed to list backup folders: Dropbox listing error 500/i,
    );

    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
  });

  it('records start, finish, trigger, and who in the manifest', async () => {
    const client = createMockDropboxClient();
    let uploadedManifestJson = '';

    (client.uploadFile as ReturnType<typeof vi.fn>).mockImplementation((_token, dropboxPath, contents: Buffer) => {
      if (dropboxPath.endsWith('manifest.json')) {
        uploadedManifestJson = contents.toString('utf8');
      }
      return Promise.resolve();
    });

    const manifest = await performBackup({
      dropboxClient: client,
      db: createFakeDb(),
      trigger: 'daily check',
      who: 'josh',
    });

    expect(manifest.startedAt).toBeDefined();
    expect(manifest.finishedAt).toBeDefined();
    expect(manifest.trigger).toBe('daily check');
    expect(manifest.who).toBe('josh');

    expect(uploadedManifestJson).not.toBe('');
    const parsedUploaded = JSON.parse(uploadedManifestJson) as BackupManifest;
    expect(parsedUploaded.startedAt).toBeDefined();
    expect(parsedUploaded.finishedAt).toBeDefined();
    expect(parsedUploaded.trigger).toBe('daily check');
    expect(parsedUploaded.who).toBe('josh');
  });

  it('holds first export pending and verifies second start begins neither export nor upload', async () => {
    let resolveExport: (val: unknown) => void;
    const exportPending = new Promise((resolve) => {
      resolveExport = resolve;
    });

    const pendingDb: DbLike = {
      listCollections: () => ({
        toArray: () => exportPending.then(() => [{ name: 'user' }]),
      }),
      collection: () => ({
        find: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          [Symbol.asyncIterator]: async function* asyncIterator() {
            yield { name: 'josh' };
          },
        }),
      }),
    };

    const client = createMockDropboxClient();
    const firstRunPromise = performBackup({ dropboxClient: client, db: pendingDb });

    // Allow first run to execute until awaiting export
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(isBackupActive()).toBe(true);

    // Second run attempted while first run export is still pending
    const secondDbListCollections = vi.fn(() => ({
      toArray: () => Promise.resolve([{ name: 'user' }]),
    }));
    const secondDb: DbLike = {
      listCollections: secondDbListCollections,
      collection: () => ({
        find: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          [Symbol.asyncIterator]: async function* asyncIterator() {
            yield { name: 'other' };
          },
        }),
      }),
    };

    await expect(performBackup({ dropboxClient: client, db: secondDb })).rejects.toThrow(
      /backup run in progress/i,
    );

    // Second run must have started neither export nor upload
    expect(secondDbListCollections).not.toHaveBeenCalled();
    expect(client.uploadFile).not.toHaveBeenCalled();

    // Now complete the first export
    resolveExport!([{ name: 'user' }]);
    const manifest = await firstRunPromise;

    expect(manifest.databases.webjamsalem.ok).toBe(true);
    expect(client.uploadFile).toHaveBeenCalled();
    expect(isBackupActive()).toBe(false);
  });

  it('failed active export uploads zero files and releases the run guard for subsequent runs', async () => {
    let rejectExport: (err: Error) => void;
    const exportPending = new Promise((_, reject) => {
      rejectExport = reject;
    });

    const failingDb: DbLike = {
      listCollections: () => ({
        toArray: () => exportPending.then(() => [{ name: 'user' }]),
      }),
      collection: () => ({
        find: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          [Symbol.asyncIterator]: async function* asyncIterator() {
            yield { name: 'josh' };
          },
        }),
      }),
    };

    const client = createMockDropboxClient();
    const firstRunPromise = performBackup({ dropboxClient: client, db: failingDb });

    await new Promise((resolve) => { setTimeout(resolve, 10); });
    expect(isBackupActive()).toBe(true);

    // Competing start while active is refused
    await expect(performBackup({ dropboxClient: client, db: createFakeDb() })).rejects.toThrow(
      /backup run in progress/i,
    );

    // Reject the active export
    rejectExport!(new Error('Mongo network timeout'));
    await expect(firstRunPromise).rejects.toThrow(/one or more databases failed export/i);

    // Uploaded no backup files
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(client.deletePath).not.toHaveBeenCalled();
    expect(fs.readdirSync(outputRoot())).toHaveLength(0);

    // Reservation is released
    expect(isBackupActive()).toBe(false);

    // Subsequent backup can now start and succeed
    const subsequentManifest = await performBackup({ dropboxClient: client, db: createFakeDb() });
    expect(subsequentManifest.databases.webjamsalem.ok).toBe(true);
    expect(client.uploadFile).toHaveBeenCalled();
  });

  it('parallel starts in the same turn refuse competing runs via single-run reservation', async () => {
    const client = createMockDropboxClient();
    const p1 = performBackup({ dropboxClient: client, db: createFakeDb() });
    const p2 = performBackup({ dropboxClient: client, db: createFakeDb() });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/backup run in progress/i);
    expect(isBackupActive()).toBe(false);
  });

  it('retention pruning aborts and deletes nothing when readManifest throws on a lookup error', async () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const existingFolders = [
      '2026-10-01T00-00-00-000Z', // good 1
      '2026-10-07T10-00-00-000Z', // 26h old, but readManifest encounters 409 restricted_content
    ];

    const goodManifest: BackupManifest = {
      startedAt: '2026-10-01T00:00:00.000Z',
      finishedAt: '2026-10-01T00:01:00.000Z',
      generatedAt: '2026-10-01T00:00:00.000Z',
      databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
    };

    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.resolve([...existingFolders, '2026-10-08T12-00-00-000Z'])),
      readManifest: vi.fn((_token, label) => {
        if (label === '2026-10-07T10-00-00-000Z') {
          // Throws lookup error instead of returning null
          return Promise.reject(new Error('dropbox download failed: 409 Conflict (path/restricted_content)'));
        }
        return Promise.resolve(goodManifest);
      }),
    });

    await performBackup({
      dropboxClient: client,
      db: createFakeDb(),
      now,
    });

    // deletePath must NOT have been called on the uncertain folder or any other folder
    expect(client.deletePath).not.toHaveBeenCalled();
  });

  it('verifies that src contains zero references to process.env.DROPBOX_', () => {
    const srcDir = path.resolve(__dirname, '../../../src');
    function scanFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...scanFiles(full));
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) out.push(full);
      }
      return out;
    }

    const files = scanFiles(srcDir);
    const matches: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('process.env.DROPBOX_')) {
        matches.push(file);
      }
    }
    expect(matches).toEqual([]);
  });
});

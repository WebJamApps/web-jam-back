// Auth-gating test for POST /admin/backup (web-jam-tools#116, web-jam-back#1141).
// Mocks Dropbox and injects Mongo fixtures — this file never touches a real database or the
// network. The caller-attribution case runs the real export through the Express route.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AuthRequest } from '#src/auth/authUtils.js';
import type { BackupManifest, DbLike, RunBackupOptions } from '#src/lib/backup-export.js';
import type { DropboxClientLike } from '#src/model/backup/backup-controller.js';

vi.mock('#src/lib/utils.js', () => ({
  default: { mongoConnect: vi.fn(() => Promise.resolve()) },
}));

const runFullBackup = vi.fn<(outDir: string, opts?: RunBackupOptions) => Promise<BackupManifest>>(() => Promise.resolve({
  generatedAt: new Date().toISOString(),
  databases: { webjamsalem: { ok: true, collections: {} } },
}));
vi.mock('#src/lib/backup-export.js', () => ({
  runFullBackup,
  default: { runFullBackup },
}));

const dropboxConfigured = vi.fn(() => true);
const getAccessToken = vi.fn(() => Promise.resolve('mock-token'));
const listSubfolders = vi.fn(() => Promise.resolve([]));
const readManifest = vi.fn(() => Promise.resolve({
  generatedAt: new Date().toISOString(),
  databases: { webjamsalem: { ok: true, collections: {} } },
}));
const uploadFile = vi.fn<DropboxClientLike['uploadFile']>(() => Promise.resolve());
const deletePath = vi.fn(() => Promise.resolve());
const uploadBackupAndPrune = vi.fn(() => Promise.resolve());
const BACKUP_ROOT = '/webjam-backups';
const RETAIN_RUNS = 8;
const isGoodRun = vi.fn(() => true);
const parseRunDate = vi.fn(() => null);
const foldersToPrune = vi.fn(() => []);
const listFilesRecursive = vi.fn<(dir: string) => string[]>(() => []);

vi.mock('#src/lib/dropbox.js', () => ({
  dropboxConfigured,
  getAccessToken,
  listSubfolders,
  readManifest,
  uploadFile,
  deletePath,
  uploadBackupAndPrune,
  BACKUP_ROOT,
  RETAIN_RUNS,
  isGoodRun,
  parseRunDate,
  foldersToPrune,
  listFilesRecursive,
  default: {
    dropboxConfigured,
    getAccessToken,
    listSubfolders,
    readManifest,
    uploadFile,
    deletePath,
    uploadBackupAndPrune,
    BACKUP_ROOT,
    RETAIN_RUNS,
    isGoodRun,
    parseRunDate,
    foldersToPrune,
    listFilesRecursive,
  },
}));

const { default: app } = await import('#src/index.js');
const { default: authUtils } = await import('#src/auth/authUtils.js');
const { resetActiveBackup, isBackupActive } = await import('#src/model/backup/backup-controller.js');
const { default: request } = await import('../../helpers/api.js');

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

describe('POST /admin/backup', () => {
  beforeEach(() => {
    resetActiveBackup();
    runFullBackup.mockClear();
    dropboxConfigured.mockClear();
    dropboxConfigured.mockReturnValue(true);
    uploadBackupAndPrune.mockClear();
    listSubfolders.mockClear();
    uploadFile.mockClear();
    readManifest.mockClear();
  });

  afterEach(() => {
    resetActiveBackup();
  });

  it('uploads a manifest identifying the authenticated caller rather than a body-supplied identity', async () => {
    const exporter = await vi.importActual<typeof import('#src/lib/backup-export.js')>('#src/lib/backup-export.js');
    const storage = await vi.importActual<typeof import('#src/lib/dropbox.js')>('#src/lib/dropbox.js');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-caller-test-'));
    const originalEnv = { ...process.env };
    const originalAuthenticate = authUtils.ensureAuthenticated;
    const callerId = 'authenticated-fixture-user';
    const db: DbLike = {
      listCollections: () => ({ toArray: () => Promise.resolve([{ name: 'user' }]) }),
      collection: () => ({
        find: () => ({
          // eslint-disable-next-line @typescript-eslint/require-await
          [Symbol.asyncIterator]: async function* asyncIterator() {
            yield { name: 'fixture' };
          },
        }),
      }),
    };
    let uploadedManifest: BackupManifest | undefined;
    try {
      process.env.BACKUP_OUTPUT_DIR = tempRoot;
      runFullBackup.mockImplementationOnce((outDir, opts) => exporter.runFullBackup(outDir, {
        ...opts,
        primaryUri: 'mongodb://injected-fixture',
        connect: () => Promise.resolve({ db, close: () => Promise.resolve() }),
      }));
      listFilesRecursive.mockImplementation(storage.listFilesRecursive);
      uploadFile.mockImplementation((_token, dest, contents) => {
        if (dest.endsWith('/manifest.json')) {
          uploadedManifest = JSON.parse(contents.toString('utf8')) as BackupManifest;
        }
        return Promise.resolve();
      });
      authUtils.ensureAuthenticated = vi.fn((req: AuthRequest) => {
        req.user = callerId;
        return Promise.resolve();
      });

      const response = await request(app).post('/admin/backup')
        .set('Authorization', 'fixture-request')
        .send({ who: 'spoofed-body-user' });
      expect(response.status).toBe(202);
      await vi.waitFor(() => expect(isBackupActive()).toBe(false));
      expect(runFullBackup).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ who: callerId }));
      expect(uploadedManifest).toMatchObject({
        trigger: 'backup button',
        who: callerId,
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      });
    } finally {
      authUtils.ensureAuthenticated = originalAuthenticate;
      process.env = originalEnv;
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects a request with no Authorization header (401), and never starts an export', async () => {
    const r = await request(app).post('/admin/backup');
    expect(r.status).toBe(401);
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
  });

  it('rejects a request whose token fails ensureAuthenticated (401), and never starts an export', async () => {
    (authUtils as unknown as { ensureAuthenticated: ReturnType<typeof vi.fn> }).ensureAuthenticated = vi.fn(
      () => Promise.reject(new Error('The user does not have the permission')),
    );
    const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer not-a-real-token');
    expect(r.status).toBe(401);
    expect(r.body.message).toContain('permission');
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
  });

  it('when backup settings are absent, refuses the request (500) and never starts an export', async () => {
    dropboxConfigured.mockReturnValue(false);
    (authUtils as unknown as { ensureAuthenticated: ReturnType<typeof vi.fn> }).ensureAuthenticated = vi.fn(
      () => Promise.resolve(),
    );
    const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer service-token');
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/Dropbox backup settings absent/i);

    await flush();
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('when a backup is already in progress, refuses the request (409) and never starts another export', async () => {
    (authUtils as unknown as { ensureAuthenticated: ReturnType<typeof vi.fn> }).ensureAuthenticated = vi.fn(
      () => Promise.resolve(),
    );
    let resolveExport: (val: unknown) => void = () => {};
    const exportPending = new Promise((resolve) => {
      resolveExport = resolve;
    });
    runFullBackup.mockImplementationOnce(() => exportPending as Promise<never>);

    const r1 = await request(app).post('/admin/backup').set('Authorization', 'Bearer service-token');
    expect(r1.status).toBe(202);
    expect(r1.body.message).toMatch(/backup started/i);

    // Guard is held
    expect(isBackupActive()).toBe(true);

    // Second request while first is in progress
    const r2 = await request(app).post('/admin/backup').set('Authorization', 'Bearer service-token');
    expect(r2.status).toBe(409);
    expect(r2.body.message).toMatch(/backup run in progress/i);

    // Complete the first run
    resolveExport({
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      trigger: 'backup button',
      databases: { webjamsalem: { ok: true, collections: {} } },
    });
    await flush();
    await flush();
    expect(runFullBackup).toHaveBeenCalledTimes(1);
  });

  it('responds 202 immediately for an authenticated caller and kicks off the export async', async () => {
    (authUtils as unknown as { ensureAuthenticated: ReturnType<typeof vi.fn> }).ensureAuthenticated = vi.fn(
      () => Promise.resolve(),
    );
    const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer service-token');
    expect(r.status).toBe(202);
    expect(r.body.message).toMatch(/backup started/i);

    // The export runs fire-and-forget (not awaited by the route handler) — flush
    // the microtask queue to observe it having been kicked off.
    await flush();
    await flush();
    expect(runFullBackup).toHaveBeenCalledTimes(1);
  });
});

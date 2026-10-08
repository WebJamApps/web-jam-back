// Auth-gating test for POST /admin/backup (web-jam-tools#116, web-jam-back#1141).
// Mocks Dropbox + the Mongo export entirely — this file never touches a real database or the
// network — and drives the route through the real Express app + real
// authUtils.ensureAuthenticated.

const runFullBackup = vi.fn(() => Promise.resolve({
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
const uploadFile = vi.fn(() => Promise.resolve());
const deletePath = vi.fn(() => Promise.resolve());
const uploadBackupAndPrune = vi.fn(() => Promise.resolve());
const BACKUP_ROOT = '/webjam-backups';
const RETAIN_RUNS = 8;
const isGoodRun = vi.fn(() => true);
const parseRunDate = vi.fn(() => null);
const foldersToPrune = vi.fn(() => []);
const listFilesRecursive = vi.fn(() => []);

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
const { default: request } = await import('../../helpers/api.js');

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

describe('POST /admin/backup', () => {
  beforeEach(() => {
    runFullBackup.mockClear();
    dropboxConfigured.mockClear();
    dropboxConfigured.mockReturnValue(true);
    uploadBackupAndPrune.mockClear();
    listSubfolders.mockClear();
    uploadFile.mockClear();
    readManifest.mockClear();
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

  it('when backup settings are absent, responds 202 but never starts an export', async () => {
    dropboxConfigured.mockReturnValue(false);
    (authUtils as unknown as { ensureAuthenticated: ReturnType<typeof vi.fn> }).ensureAuthenticated = vi.fn(
      () => Promise.resolve(),
    );
    const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer service-token');
    expect(r.status).toBe(202);
    expect(r.body.message).toMatch(/backup started/i);

    await flush();
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
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

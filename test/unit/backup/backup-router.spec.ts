/* eslint-disable @typescript-eslint/no-explicit-any */
// Auth-gating test for POST /admin/backup (web-jam-tools#116). Mocks Dropbox +
// the Mongo export entirely — this file never touches a real database or the
// network — and drives the route through the real Express app + real
// authUtils.ensureAuthenticated, the same integration style as
// test/unit/user/user-router.spec.ts (including that file's convention of
// swapping authUtils.ensureAuthenticated for a stub to simulate "authenticated").

const runFullBackup = vi.fn(() => Promise.resolve({ generatedAt: new Date().toISOString(), databases: {} }));
vi.mock('#src/lib/backup-export.js', () => ({
  runFullBackup,
  default: { runFullBackup },
}));

const dropboxConfigured = vi.fn(() => false);
const uploadBackupAndPrune = vi.fn(() => Promise.resolve());
vi.mock('#src/lib/dropbox.js', () => ({
  dropboxConfigured,
  uploadBackupAndPrune,
  default: { dropboxConfigured, uploadBackupAndPrune },
}));

const { default: app } = await import('#src/index.js');
const { default: authUtils } = await import('#src/auth/authUtils.js');
const { default: request } = await import('../../helpers/api.js');

const flush = () => new Promise((resolve) => { setImmediate(resolve); });

describe('POST /admin/backup', () => {
  beforeEach(() => {
    runFullBackup.mockClear();
    dropboxConfigured.mockClear();
    uploadBackupAndPrune.mockClear();
  });

  it('rejects a request with no Authorization header (401), and never starts an export', async () => {
    const r = await request(app).post('/admin/backup');
    expect(r.status).toBe(401);
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
  });

  it('rejects a request whose token fails ensureAuthenticated (401), and never starts an export', async () => {
    (authUtils as any).ensureAuthenticated = vi.fn(() => Promise.reject(new Error('The user does not have the permission')));
    const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer not-a-real-token');
    expect(r.status).toBe(401);
    expect(r.body.message).toContain('permission');
    await flush();
    expect(runFullBackup).not.toHaveBeenCalled();
  });

  it('responds 202 immediately for an authenticated caller and kicks off the export async', async () => {
    (authUtils as any).ensureAuthenticated = vi.fn(() => Promise.resolve());
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

// Auth-gating test for /admin/backup routes (web-jam-tools#116, web-jam-back#1141, web-jam-back#1143).
// Mocks Dropbox and injects Mongo fixtures — this file never touches a real database or the
// network. The caller-attribution case runs the real export through the Express route.
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AuthRequest } from '#src/auth/authUtils.js';
import type { BackupManifest, DbLike, RunBackupOptions } from '#src/lib/backup-export.js';
import type { DropboxClientLike } from '#src/model/backup/backup-controller.js';
import mongoose from 'mongoose';
import type { RestoreProductionOptions } from '#src/model/backup/backup-restore.js';

// The restore module is covered by backup-restore.spec.ts; here only the route is under test.
const mocks = vi.hoisted(() => ({
  restoreProduction: vi.fn(),
  restoreActive: false,
  rebuild: undefined as undefined | ((collections: string[]) => Promise<unknown>),
}));
vi.mock('#src/model/backup/backup-restore.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#src/model/backup/backup-restore.js')>();
  return {
    ...original,
    restoreProduction: mocks.restoreProduction,
    isRestoreActive: () => mocks.restoreActive || original.isRestoreActive(),
    mongooseIndexRebuilder: (conn: Parameters<typeof original.mongooseIndexRebuilder>[0]) => mocks.rebuild || original.mongooseIndexRebuilder(conn),
  };
});

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
const listSubfolders = vi.fn<(accessToken: string, folderPath: string) => Promise<string[]>>(() => Promise.resolve([]));
const readManifest = vi.fn<(accessToken: string, runLabel: string) => Promise<BackupManifest | null>>(() => Promise.resolve({
  generatedAt: new Date().toISOString(),
  databases: { webjamsalem: { ok: true, collections: {} } },
}));
const uploadFile = vi.fn<DropboxClientLike['uploadFile']>(() => Promise.resolve());
const deletePath = vi.fn(() => Promise.resolve());
const uploadBackupAndPrune = vi.fn(() => Promise.resolve());
const getFolderSize = vi.fn(() => Promise.resolve(2048));
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
  getFolderSize,
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
    getFolderSize,
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
const { resetActiveBackup, isBackupActive, performBackup } = await import('#src/model/backup/backup-controller.js');
const { default: userModel } = await import('#src/model/user/user-schema.js');
const { resetOperations, recordOperation } = await import('#src/model/backup/backup-operations.js');
const { default: request } = await import('../../helpers/api.js');

process.env.HashString = process.env.HashString || 'test-jwt-secret';
const flush = () => new Promise((resolve) => { setImmediate(resolve); });
const originalEnsureAuthenticated = authUtils.ensureAuthenticated;

describe('/admin/backup router', () => {
  const devToken = authUtils.createJWT({ _id: 'dev-user-id' });
  const otherToken = authUtils.createJWT({ _id: 'other-user-id' });

  const mockUserRole = (userType: string) => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve({ userType }),
      }),
    } as never);
  };

  const mockUserThrow = (err: Error) => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({
        exec: () => Promise.reject(err),
      }),
    } as never);
  };

  beforeEach(() => {
    authUtils.ensureAuthenticated = originalEnsureAuthenticated;
    resetActiveBackup();
    resetOperations();
    runFullBackup.mockClear();
    dropboxConfigured.mockClear();
    dropboxConfigured.mockReturnValue(true);
    uploadBackupAndPrune.mockClear();
    listSubfolders.mockClear();
    uploadFile.mockClear();
    readManifest.mockClear();
    getFolderSize.mockClear();
    getFolderSize.mockResolvedValue(2048);
    mockUserRole('Developer');
  });

  afterEach(() => {
    authUtils.ensureAuthenticated = originalEnsureAuthenticated;
    resetActiveBackup();
    resetOperations();
    vi.restoreAllMocks();
  });

  describe('POST /admin/backup', () => {
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
        const callerToken = authUtils.createJWT({ _id: callerId });
        const response = await request(app).post('/admin/backup')
          .set('Authorization', `Bearer ${callerToken}`)
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

    it('rejects a request whose token is invalid (401), and never starts an export', async () => {
      const r = await request(app).post('/admin/backup').set('Authorization', 'Bearer not-a-real-token');
      expect(r.status).toBe(401);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses a caller whose account holds another role (401), and starts nothing', async () => {
      mockUserRole('JaM-admin');
      const r = await request(app).post('/admin/backup').set('Authorization', `Bearer ${otherToken}`);
      expect(r.status).toBe(401);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses with 500 when the account lookup throws, and starts nothing', async () => {
      mockUserThrow(new Error('DB failure during user lookup'));
      const r = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(r.body.message).toMatch(/DB failure during user lookup/i);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('when backup settings are absent, refuses the request (500) and never starts an export', async () => {
      dropboxConfigured.mockReturnValue(false);
      const r = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(r.body.message).toMatch(/Dropbox backup settings absent/i);

      await flush();
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('when a backup is already in progress, refuses the request (409) and never starts another export', async () => {
      let resolveExport: (val: unknown) => void = () => {};
      const exportPending = new Promise((resolve) => {
        resolveExport = resolve;
      });
      runFullBackup.mockImplementationOnce(() => exportPending as Promise<never>);

      const r1 = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r1.status).toBe(202);
      expect(r1.body.message).toMatch(/backup started/i);

      expect(isBackupActive()).toBe(true);

      const r2 = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r2.status).toBe(409);
      expect(r2.body.message).toMatch(/backup run in progress/i);

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

    it('responds 202 immediately for an authenticated Developer caller and kicks off the export async', async () => {
      const r = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(202);
      expect(r.body.message).toMatch(/backup started/i);

      await flush();
      await flush();
      expect(runFullBackup).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /admin/backup/runs', () => {
    it('serves a caller whose account holds the Developer role with list of runs, newest first', async () => {
      listSubfolders.mockResolvedValue(['2026-10-07T10-00-00-000Z', '2026-10-07T20-00-00-000Z']);
      readManifest.mockImplementation((_token: string, name: string) => {
        if (name === '2026-10-07T20-00-00-000Z') {
          return Promise.resolve({
            startedAt: '2026-10-07T20:00:00.000Z',
            trigger: 'daily check',
            generatedAt: '2026-10-07T20:00:00.000Z',
            databases: { webjamsalem: { ok: true, collections: { user: 12, gigs: 5 } } },
          });
        }
        return Promise.resolve({
          startedAt: '2026-10-07T10:00:00.000Z',
          trigger: 'backup button',
          generatedAt: '2026-10-07T10:00:00.000Z',
          databases: { webjamsalem: { ok: false, reason: 'error', collections: {} } },
        });
      });

      const r = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body).toHaveLength(2);
      expect(r.body[0].name).toBe('2026-10-07T20-00-00-000Z');
      expect(r.body[0].state).toBe('good');
      expect(r.body[0].trigger).toBe('daily check');
      expect(r.body[0].size).toBe(2048);
      expect(r.body[0].collections).toEqual({ webjamsalem: { user: 12, gigs: 5 } });
      expect(r.body[1].name).toBe('2026-10-07T10-00-00-000Z');
      expect(r.body[1].state).toBe('failed');
    });

    it('refuses a caller whose account holds another role (401)', async () => {
      mockUserRole('JaM-admin');
      const r = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${otherToken}`);
      expect(r.status).toBe(401);
      expect(listSubfolders).not.toHaveBeenCalled();
    });

    it('refuses a caller who is not logged in (401)', async () => {
      const r = await request(app).get('/admin/backup/runs');
      expect(r.status).toBe(401);
      expect(listSubfolders).not.toHaveBeenCalled();
    });

    it('refuses with 500 when the account lookup throws', async () => {
      mockUserThrow(new Error('DB failure'));
      const r = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(listSubfolders).not.toHaveBeenCalled();
    });

    it('refuses with 500 when Dropbox settings are absent', async () => {
      dropboxConfigured.mockReturnValue(false);
      const r = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(r.body.message).toMatch(/Dropbox backup settings absent/i);
    });
  });

  describe('POST /admin/backup/runs', () => {
    it('starts a run, answers at once (202) with the run name, and records operation', async () => {
      const r = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);

      expect(r.status).toBe(202);
      expect(r.body).toHaveProperty('name');
      expect(typeof r.body.name).toBe('string');
      expect(r.body.message).toMatch(/backup started/i);

      await flush();
      await flush();
      expect(runFullBackup).toHaveBeenCalledTimes(1);
    });

    it('refuses a caller whose account holds another role (401), and starts nothing', async () => {
      mockUserRole('JaM-admin');
      const r = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${otherToken}`);
      expect(r.status).toBe(401);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses a caller who is not logged in (401), and starts nothing', async () => {
      const r = await request(app).post('/admin/backup/runs');
      expect(r.status).toBe(401);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses with 500 when the account lookup throws, and starts nothing', async () => {
      mockUserThrow(new Error('DB failure'));
      const r = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      await flush();
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses with 409 when a backup is already in progress', async () => {
      let resolveExport: (val: unknown) => void = () => {};
      const exportPending = new Promise((resolve) => {
        resolveExport = resolve;
      });
      runFullBackup.mockImplementationOnce(() => exportPending as Promise<never>);

      const r1 = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r1.status).toBe(202);

      const r2 = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r2.status).toBe(409);
      expect(r2.body.message).toMatch(/backup run in progress/i);

      resolveExport({
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        trigger: 'backup button',
        databases: { webjamsalem: { ok: true, collections: {} } },
      });
      await flush();
      await flush();
    });

    it('refuses with 500 when Dropbox settings are absent', async () => {
      dropboxConfigured.mockReturnValue(false);
      const r = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(r.body.message).toMatch(/Dropbox backup settings absent/i);
    });
  });

  describe('GET /admin/backup/operations/:name', () => {
    it('reports the progress and result of a started operation', async () => {
      const opName = 'test-op-123';
      recordOperation({
        name: opName,
        type: 'backup',
        status: 'completed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        progress: 'complete',
        result: { generatedAt: '2026-10-07', databases: {} },
      });

      const r = await request(app)
        .get(`/admin/backup/operations/${opName}`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(r.status).toBe(200);
      expect(r.body.name).toBe(opName);
      expect(r.body.status).toBe('completed');
      expect(r.body.progress).toBe('complete');
      expect(r.body.result).toEqual({ generatedAt: '2026-10-07', databases: {} });
    });

    it('falls back to Dropbox manifest if operation was completed in earlier process', async () => {
      const opName = 'dropbox-manifest-op';
      readManifest.mockResolvedValueOnce({
        startedAt: '2026-10-07T12:00:00.000Z',
        finishedAt: '2026-10-07T12:01:00.000Z',
        generatedAt: '2026-10-07T12:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: {} } },
      });

      const r = await request(app)
        .get(`/admin/backup/operations/${opName}`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(r.status).toBe(200);
      expect(r.body.name).toBe(opName);
      expect(r.body.status).toBe('completed');
    });

    it('refuses a caller whose account holds another role (401)', async () => {
      mockUserRole('JaM-admin');
      const r = await request(app)
        .get('/admin/backup/operations/any-op')
        .set('Authorization', `Bearer ${otherToken}`);
      expect(r.status).toBe(401);
    });

    it('refuses a caller who is not logged in (401)', async () => {
      const r = await request(app).get('/admin/backup/operations/any-op');
      expect(r.status).toBe(401);
    });

    it('refuses with 500 when the account lookup throws', async () => {
      mockUserThrow(new Error('DB failure'));
      const r = await request(app)
        .get('/admin/backup/operations/any-op')
        .set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
    });

    it('returns 404 when operation is not found', async () => {
      readManifest.mockResolvedValueOnce(null);
      const r = await request(app)
        .get('/admin/backup/operations/non-existent-op')
        .set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(404);
      expect(r.body.message).toMatch(/not found/i);
    });

    it('refuses path traversal characters in operation name with 400', async () => {
      const r = await request(app)
        .get('/admin/backup/operations/..%2fevil')
        .set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/invalid operation name/i);
    });

    it('returns 500 when dropbox readManifest throws an error', async () => {
      readManifest.mockRejectedValueOnce(new Error('Dropbox network timeout'));
      const r = await request(app)
        .get('/admin/backup/operations/2026-10-07T12-00-00-000Z')
        .set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(500);
      expect(r.body.message).toMatch(/Dropbox network timeout/i);
    });
  });

  describe('AUTH_ROLES independence', () => {
    it('serves Developer and refuses JaM-admin across all routes even when AUTH_ROLES.admin excludes Developer', async () => {
      const originalAuthRoles = process.env.AUTH_ROLES;
      try {
        process.env.AUTH_ROLES = JSON.stringify({ admin: ['Staff', 'Finance'] });

        // 1. GET /admin/backup/runs serves Developer
        mockUserRole('Developer');
        listSubfolders.mockResolvedValueOnce(['2026-10-07T20-00-00-000Z']);
        readManifest.mockResolvedValueOnce({
          generatedAt: '2026-10-07T20:00:00.000Z',
          databases: { webjamsalem: { ok: true, collections: {} } },
        });
        const rDevRuns = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
        expect(rDevRuns.status).toBe(200);

        // 2. POST /admin/backup serves Developer
        const rDevPost = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
        expect(rDevPost.status).toBe(202);

        // 3. POST /admin/backup/runs serves Developer
        resetActiveBackup();
        const rDevPostRuns = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
        expect(rDevPostRuns.status).toBe(202);

        // 4. GET /admin/backup/runs refuses JaM-admin
        mockUserRole('JaM-admin');
        const rOtherRuns = await request(app).get('/admin/backup/runs').set('Authorization', `Bearer ${otherToken}`);
        expect(rOtherRuns.status).toBe(401);

        // 5. POST /admin/backup refuses JaM-admin
        const rOtherPost = await request(app).post('/admin/backup').set('Authorization', `Bearer ${otherToken}`);
        expect(rOtherPost.status).toBe(401);
      } finally {
        if (originalAuthRoles !== undefined) {
          process.env.AUTH_ROLES = originalAuthRoles;
        } else {
          delete process.env.AUTH_ROLES;
        }
      }
    });
  });
});

describe('POST /admin/backup/runs/:name/restore', () => {
  const RUN = '2026-10-08T12-00-00-000Z';
  const devToken = authUtils.createJWT({ _id: 'dev-user-id' });
  const otherToken = authUtils.createJWT({ _id: 'other-user-id' });
  const restoreUrl = `/admin/backup/runs/${RUN}/restore`;
  const restoreResult = {
    collections: [{ collection: 'song', restored: 3, manifest: 3 }],
    missingIndexes: [{ collection: 'song', index: 'by_hand_1' }],
  };
  const connection = mongoose.connection as unknown as { db?: unknown };
  const originalDb = connection.db;

  const mockUserRole = (userType: string) => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ userType }) }),
    } as never);
  };

  const waitForOperation = async (name: string, status: string) => {
    let body: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      const r = await request(app).get(`/admin/backup/operations/${name}`).set('Authorization', `Bearer ${devToken}`);
      body = r.body as Record<string, unknown>;
      expect(body.status).toBe(status);
    });
    return body;
  };

  beforeEach(() => {
    authUtils.ensureAuthenticated = originalEnsureAuthenticated;
    resetActiveBackup();
    resetOperations();
    runFullBackup.mockClear();
    dropboxConfigured.mockReturnValue(true);
    mocks.restoreActive = false;
    mocks.rebuild = undefined;
    mocks.restoreProduction.mockResolvedValue(restoreResult);
    connection.db = {};
    mockUserRole('Developer');
  });

  afterEach(() => {
    connection.db = originalDb;
    resetActiveBackup();
    resetOperations();
    vi.restoreAllMocks();
  });

  it('serves the Developer role: answers at once (202) with the operation name, then reports the result', async () => {
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    expect(r.status).toBe(202);
    expect(r.body.name).toMatch(/^restore-/);
    expect(r.body.message).toMatch(/restore started/i);

    const op = await waitForOperation(r.body.name as string, 'completed');
    expect(op).toMatchObject({ type: 'restore', progress: 'complete', result: restoreResult });
    expect(mocks.restoreProduction).toHaveBeenCalledWith(expect.objectContaining({
      runName: RUN,
      typedDate: '2026-10-08',
      freshBackupLabel: (r.body.name as string).replace(/^restore-/, ''),
    }));
  });

  it('records a refusal as a failed operation that says which guard refused', async () => {
    const { RestoreRefusal } = await vi.importActual<typeof import('#src/model/backup/backup-restore.js')>('#src/model/backup/backup-restore.js');
    mocks.restoreProduction.mockRejectedValue(new RestoreRefusal('date', 'the typed date does not match'));
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '1999-01-01' });
    expect(r.status).toBe(202);
    const op = await waitForOperation(r.body.name as string, 'failed');
    expect(op).toMatchObject({ progress: 'failed', error: 'the typed date does not match' });
  });

  it('reports each step through the operations route while the restore runs', async () => {
    let finish: () => void = () => undefined;
    mocks.restoreProduction.mockImplementation((o: RestoreProductionOptions) => {
      o.onProgress?.('taking a fresh backup of production');
      return new Promise((resolve) => { finish = () => resolve(restoreResult); });
    });
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    await vi.waitFor(async () => {
      const op = await request(app).get(`/admin/backup/operations/${r.body.name}`).set('Authorization', `Bearer ${devToken}`);
      expect(op.body).toMatchObject({ status: 'in_progress', progress: 'taking a fresh backup of production' });
    });
    finish();
    await waitForOperation(r.body.name as string, 'completed');
  });

  it('takes the fresh backup through performBackup, triggered as a restore and attributed to the caller', async () => {
    mocks.restoreProduction.mockImplementation(async (o: RestoreProductionOptions) => {
      await o.takeFreshBackup();
      return restoreResult;
    });
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    await waitForOperation(r.body.name as string, 'completed');
    expect(runFullBackup).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ trigger: 'restore' }));
  });

  it('rebuilds indexes through the declared models for the restored collections', async () => {
    const rebuilt: string[][] = [];
    mocks.restoreProduction.mockImplementation(async (o: RestoreProductionOptions) => {
      // Nothing is registered under these names, so the default rebuilder has nothing to build.
      await o.rebuildIndexes?.(['no-such-collection']);
      rebuilt.push(['called']);
      return restoreResult;
    });
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    await waitForOperation(r.body.name as string, 'completed');
    expect(rebuilt).toEqual([['called']]);
  });

  it('returns the index failures the rebuilder reports, so the result can show them', async () => {
    const failure = { collection: 'user', message: 'E11000 duplicate key' };
    mocks.rebuild = () => Promise.resolve([failure]);
    let returned: unknown;
    mocks.restoreProduction.mockImplementation(async (o: RestoreProductionOptions) => {
      returned = await o.rebuildIndexes?.(['user']);
      return restoreResult;
    });
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    await waitForOperation(r.body.name as string, 'completed');
    expect(returned).toEqual([failure]);
  });

  describe('while a restore holds the database', () => {
    beforeEach(() => { mocks.restoreActive = true; });

    it('refuses POST /admin/backup/runs (409) and starts no export', async () => {
      const r = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(409);
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses POST /admin/backup (409) and starts no export', async () => {
      const r = await request(app).post('/admin/backup').set('Authorization', `Bearer ${devToken}`);
      expect(r.status).toBe(409);
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it('refuses a direct performBackup call (the scheduler path) and exports nothing', async () => {
      await expect(performBackup({})).rejects.toThrow(/restore in progress/);
      expect(runFullBackup).not.toHaveBeenCalled();
    });

    it("lets the restore's own fresh backup run", async () => {
      await expect(performBackup({ duringRestore: true })).resolves.toBeDefined();
      expect(runFullBackup).toHaveBeenCalled();
    });
  });

  it('refuses a caller whose account holds another role (401), and restores nothing', async () => {
    mockUserRole('JaM-admin');
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ date: '2026-10-08' });
    expect(r.status).toBe(401);
    await flush();
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not logged in (401), and restores nothing', async () => {
    const r = await request(app).post(restoreUrl).send({ date: '2026-10-08' });
    expect(r.status).toBe(401);
    await flush();
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses with 500 when the account lookup throws, and restores nothing', async () => {
    vi.spyOn(userModel, 'findById').mockReturnValue({
      lean: () => ({ exec: () => Promise.reject(new Error('DB failure')) }),
    } as never);
    const r = await request(app).post(restoreUrl)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    expect(r.status).toBe(500);
    await flush();
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses a request with no typed date (400)', async () => {
    const r = await request(app).post(restoreUrl).set('Authorization', `Bearer ${devToken}`).send({});
    expect(r.status).toBe(400);
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses a run name that could change the Dropbox path (400)', async () => {
    const r = await request(app).post('/admin/backup/runs/..%2Fescape/restore')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ date: '2026-10-08' });
    expect(r.status).toBe(400);
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses with 500 when Dropbox settings are absent', async () => {
    dropboxConfigured.mockReturnValue(false);
    const r = await request(app).post(restoreUrl).set('Authorization', `Bearer ${devToken}`).send({ date: '2026-10-08' });
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/Dropbox backup settings absent/i);
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });

  it('refuses with 409 while a backup is in progress', async () => {
    let resolveExport: (val: unknown) => void = () => {};
    const exportPending = new Promise((resolve) => {
      resolveExport = resolve;
    });
    runFullBackup.mockImplementationOnce(() => exportPending as Promise<never>);
    const backup = await request(app).post('/admin/backup/runs').set('Authorization', `Bearer ${devToken}`);
    expect(backup.status).toBe(202);

    const r = await request(app).post(restoreUrl).set('Authorization', `Bearer ${devToken}`).send({ date: '2026-10-08' });
    expect(r.status).toBe(409);
    expect(mocks.restoreProduction).not.toHaveBeenCalled();

    resolveExport({
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      trigger: 'backup button',
      databases: { webjamsalem: { ok: true, collections: {} } },
    });
    await flush();
    await flush();
  });

  it('refuses with 500 when the database connection is not available', async () => {
    connection.db = undefined;
    const r = await request(app).post(restoreUrl).set('Authorization', `Bearer ${devToken}`).send({ date: '2026-10-08' });
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/database connection/i);
    expect(mocks.restoreProduction).not.toHaveBeenCalled();
  });
});

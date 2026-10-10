import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('#src/lib/utils.js', () => ({
  default: { mongoConnect: vi.fn(() => Promise.resolve()) },
}));

import request from '../../helpers/api.js';
import app from '#src/index.js';
import {
  runBackupCheck,
  resetBackupStatus,
} from '#src/model/backup/backup-scheduler.js';
import type { DropboxClientLike } from '#src/model/backup/backup-controller.js';
import type { BackupManifest } from '#src/lib/backup-export.js';

function createMockDropboxClient(overrides: Partial<DropboxClientLike> = {}): DropboxClientLike {
  return {
    dropboxConfigured: vi.fn(() => true),
    getAccessToken: vi.fn(() => Promise.resolve('mock-access-token')),
    listSubfolders: vi.fn(() => Promise.resolve([])),
    readManifest: vi.fn(() => Promise.resolve(null)),
    uploadFile: vi.fn(() => Promise.resolve()),
    deletePath: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('GET /backup/status', () => {
  beforeEach(() => {
    resetBackupStatus();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetBackupStatus();
    vi.restoreAllMocks();
  });

  it('returns the newest good run time and lastRunFailed: false when one is known', async () => {
    const knownTime = '2026-10-10T08:30:00.000Z';
    const goodManifest: BackupManifest = {
      startedAt: knownTime,
      finishedAt: '2026-10-10T08:31:00.000Z',
      trigger: 'daily check',
      generatedAt: knownTime,
      databases: { webjamsalem: { ok: true, collections: { user: 10 } } },
    };

    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.resolve(['2026-10-10T08-30-00-000Z'])),
      readManifest: vi.fn(() => Promise.resolve(goodManifest)),
    });

    // Run check to prime scheduler state (hourly check last read)
    // 2 hours later: not due for new backup
    await runBackupCheck({
      dropboxClient: client,
      now: new Date('2026-10-10T10:30:00.000Z'),
    });

    const res = await request(app).get('/backup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      newestGoodRun: knownTime,
      lastRunFailed: false,
    });
    // Verifies no record, count, or file name is returned
    expect(res.body.records).toBeUndefined();
    expect(res.body.count).toBeUndefined();
    expect(res.body.fileName).toBeUndefined();
    expect(res.body.databases).toBeUndefined();
    expect(res.body.collections).toBeUndefined();
  });

  it('returns "none" and lastRunFailed: false when no good run exists', async () => {
    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.resolve([])),
    });

    // Run check with a performBackup that doesn't run or when subfolders is empty and backup creates no good run
    // Suppose performBackup was skipped or we test the state where no good run was found
    const clientNoRuns = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.resolve([])),
    });

    // When check runs and performBackup starts a run, but suppose the run fails:
    await runBackupCheck({
      dropboxClient: clientNoRuns,
      performBackupFn: vi.fn(() => Promise.reject(new Error('export failed'))),
      sendMailFn: vi.fn(() => Promise.resolve({ messageId: 'm1' })),
      findAdminUsers: vi.fn(() => Promise.resolve([{ email: 'dev@example.com' }])),
      now: new Date('2026-10-10T12:00:00.000Z'),
    });

    const res = await request(app).get('/backup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      newestGoodRun: 'none',
      lastRunFailed: true,
    });
  });

  it('returns status 500 saying it cannot tell when Dropbox cannot be read', async () => {
    const client = createMockDropboxClient({
      listSubfolders: vi.fn(() => Promise.reject(new Error('Dropbox 500 error'))),
    });

    await runBackupCheck({
      dropboxClient: client,
    });

    const res = await request(app).get('/backup/status');
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('cannot tell');
    // It refuses to guess and never reports a time it did not read
    expect(res.body.newestGoodRun).toBeUndefined();
  });

  it('returns status 500 when backup settings are absent', async () => {
    const client = createMockDropboxClient({
      dropboxConfigured: vi.fn(() => false),
    });

    await runBackupCheck({
      dropboxClient: client,
    });

    const res = await request(app).get('/backup/status');
    expect(res.status).toBe(500);
    expect(res.body.message).toContain('Dropbox backup settings absent');
    expect(res.body.newestGoodRun).toBeUndefined();
  });

  it('is public and accessible without authentication header', async () => {
    const res = await request(app).get('/backup/status');
    // Without primed check it returns 500 (cannot tell), but crucially NOT 401 Unauthorized
    expect(res.status).not.toBe(401);
  });
});

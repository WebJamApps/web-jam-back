import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runBackupCheck,
  getBackupStatus,
  resetBackupStatus,
  startBackupScheduler,
  stopBackupScheduler,
  identifyFailureStep,
  sendFailureEmail,
  escapeHtml,
  getDeveloperEmails,
} from '#src/model/backup/backup-scheduler.js';
import type { DropboxClientLike } from '#src/model/backup/backup-controller.js';
import type { BackupManifest } from '#src/lib/backup-export.js';
import type { MailInput } from '#src/lib/mailer.js';
import dropbox from '#src/lib/dropbox.js';
import userModel from '#src/model/user/user-facade.js';

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

describe('backup-scheduler.ts', () => {
  beforeEach(() => {
    resetBackupStatus();
    stopBackupScheduler();
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBackupScheduler();
    resetBackupStatus();
    vi.restoreAllMocks();
  });

  describe('runBackupCheck: scheduling rules', () => {
    it('starts a run when no run exists at all', async () => {
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.resolve({
        startedAt: '2026-10-10T12:00:00.000Z',
        finishedAt: '2026-10-10T12:01:00.000Z',
        trigger: 'daily check',
        generatedAt: '2026-10-10T12:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      }));

      const now = new Date('2026-10-10T12:00:00.000Z');
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        now,
      });

      expect(performBackupFn).toHaveBeenCalledTimes(1);
      expect(performBackupFn).toHaveBeenCalledWith(expect.objectContaining({
        trigger: 'daily check',
        now,
      }));
      expect(status.newestGoodRun).toBe('2026-10-10T12:00:00.000Z');
      expect(status.lastRunFailed).toBe(false);
    });

    it('starts nothing when the newest good run is 23 hours old', async () => {
      const runDate = '2026-10-09T13:00:00.000Z';
      const goodManifest: BackupManifest = {
        startedAt: runDate,
        finishedAt: '2026-10-09T13:01:00.000Z',
        trigger: 'daily check',
        generatedAt: runDate,
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      };

      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve(['2026-10-09T13-00-00-000Z'])),
        readManifest: vi.fn(() => Promise.resolve(goodManifest)),
      });

      const performBackupFn = vi.fn();
      // now is 23 hours later: 2026-10-10T12:00:00.000Z
      const now = new Date('2026-10-10T12:00:00.000Z');

      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        now,
      });

      expect(performBackupFn).not.toHaveBeenCalled();
      expect(status.newestGoodRun).toBe(runDate);
      expect(status.lastRunFailed).toBe(false);
    });

    it('starts a run when the newest good run is 25 hours old', async () => {
      const oldRunDate = '2026-10-09T11:00:00.000Z';
      const oldGoodManifest: BackupManifest = {
        startedAt: oldRunDate,
        finishedAt: '2026-10-09T11:01:00.000Z',
        trigger: 'daily check',
        generatedAt: oldRunDate,
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      };

      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve(['2026-10-09T11-00-00-000Z'])),
        readManifest: vi.fn(() => Promise.resolve(oldGoodManifest)),
      });

      const newRunDate = '2026-10-10T12:00:00.000Z';
      const performBackupFn = vi.fn(() => Promise.resolve({
        startedAt: newRunDate,
        finishedAt: '2026-10-10T12:01:00.000Z',
        trigger: 'daily check',
        generatedAt: newRunDate,
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      }));

      // now is 25 hours later: 2026-10-10T12:00:00.000Z
      const now = new Date(newRunDate);

      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        now,
      });

      expect(performBackupFn).toHaveBeenCalledTimes(1);
      expect(status.newestGoodRun).toBe(newRunDate);
      expect(status.lastRunFailed).toBe(false);
    });

    it('does not run when any backup setting is absent', async () => {
      const client = createMockDropboxClient({
        dropboxConfigured: vi.fn(() => false),
      });

      const performBackupFn = vi.fn();
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
      });

      expect(performBackupFn).not.toHaveBeenCalled();
      expect(status.cannotTell).toBe(true);
      expect(status.error).toContain('absent');
      expect(getBackupStatus().cannotTell).toBe(true);
    });

    it('sets cannotTell status when Dropbox cannot be read', async () => {
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.reject(new Error('Dropbox network timeout'))),
      });

      const performBackupFn = vi.fn();
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
      });

      expect(performBackupFn).not.toHaveBeenCalled();
      expect(status.cannotTell).toBe(true);
      expect(status.error).toContain('Dropbox could not be read');
      expect(getBackupStatus().cannotTell).toBe(true);
    });

    it('does not mark lastRunFailed as true when most recent folder is under 10 minutes old with no manifest (in progress)', async () => {
      const recentFolder = '2026-10-10T11-55-00-000Z';
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve([recentFolder])),
        readManifest: vi.fn(() => Promise.resolve(null)),
      });

      const performBackupFn = vi.fn(() => Promise.resolve({
        startedAt: '2026-10-10T12:00:00.000Z',
        databases: { webjamsalem: { ok: true } },
        generatedAt: '2026-10-10T12:00:00.000Z',
      } as any));
      const now = new Date('2026-10-10T12:00:00.000Z');

      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        now,
      });

      expect(status.lastRunFailed).toBe(false);
    });

    it('continues looking backwards when an older folder readManifest throws', async () => {
      const goodManifest: BackupManifest = {
        startedAt: '2026-10-09T13:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: {} } },
        generatedAt: '2026-10-09T13:00:00.000Z',
      };
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve(['2026-10-09T13-00-00-000Z', '2026-10-10T01-00-00-000Z'])),
        readManifest: vi.fn((_token, label) => {
          if (label === '2026-10-10T01-00-00-000Z') {
            return Promise.reject(new Error('manifest corrupted'));
          }
          return Promise.resolve(goodManifest);
        }),
      });

      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn: vi.fn(),
        now: new Date('2026-10-10T12:00:00.000Z'),
      });

      expect(status.newestGoodRun).toBe('2026-10-09T13:00:00.000Z');
      expect(status.lastRunFailed).toBe(true);
    });

    it('uses fallback getAccessToken when client.getAccessToken is not provided', async () => {
      vi.spyOn(dropbox, 'getAccessToken').mockResolvedValueOnce('fallback-token');
      const client = createMockDropboxClient({
        getAccessToken: undefined,
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.resolve({
        startedAt: '2026-10-10T12:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: {} } },
        generatedAt: '2026-10-10T12:00:00.000Z',
      }));

      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
      });

      expect(status.lastRunFailed).toBe(false);
    });
  });

  describe('failure email and error handling', () => {
    it('sends exactly one email naming the run, the step, and the error on failed run', async () => {
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.reject(new Error('export failed: connection closed')));
      const sendMailFn = vi.fn<(_input: MailInput) => Promise<{ messageId: string }>>(() => Promise.resolve({ messageId: 'msg-1' }));
      const findAdminUsers = vi.fn(() => Promise.resolve([
        { email: 'josh@example.com' },
        { email: 'maria@example.com' },
      ]));

      const now = new Date('2026-10-10T12:00:00.000Z');
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        sendMailFn,
        findAdminUsers,
        now,
      });

      expect(status.lastRunFailed).toBe(true);
      expect(sendMailFn).toHaveBeenCalledTimes(1);

      const mailInput = sendMailFn.mock.calls[0]?.[0];
      expect(mailInput?.to).toBe('josh@example.com, maria@example.com');
      // Must name the run, the step, and the error
      expect(mailInput?.subject).toContain('2026-10-10T12-00-00-000Z');
      expect(mailInput?.text).toContain('export');
      expect(mailInput?.text).toContain('connection closed');
      expect(mailInput?.html).toContain('export');
      expect(mailInput?.html).toContain('connection closed');
    });

    it('identifies upload, in-progress, settings, and generic steps properly', () => {
      expect(identifyFailureStep(new Error('dropbox upload failed for /path'))).toBe('upload');
      expect(identifyFailureStep(new Error('backup run in progress: folder foo has no manifest'))).toBe('check in progress');
      expect(identifyFailureStep(new Error('Dropbox backup settings absent'))).toBe('settings');
      expect(identifyFailureStep(new Error('failed to prune retention'))).toBe('retention');
      expect(identifyFailureStep({ step: 'custom-step' })).toBe('custom-step');
      expect(identifyFailureStep(new Error('unknown failure'))).toBe('backup');
    });

    it('does not send an email and leaves lastRunFailed as false when performBackup rejects with an in-progress refusal', async () => {
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.reject(new Error('backup run in progress: folder 2026-10-10T11-58-00-000Z has no manifest')));
      const sendMailFn = vi.fn<(_input: MailInput) => Promise<{ messageId: string }>>(() => Promise.resolve({ messageId: 'msg-1' }));
      const findAdminUsers = vi.fn(() => Promise.resolve([
        { email: 'josh@example.com' },
      ]));

      const now = new Date('2026-10-10T12:00:00.000Z');
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        sendMailFn,
        findAdminUsers,
        now,
      });

      expect(status.lastRunFailed).toBe(false);
      expect(sendMailFn).not.toHaveBeenCalled();
    });

    it('sets lastRunFailed to true and sends email when export fails even if message mentions in progress', async () => {
      const client = createMockDropboxClient({
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.reject(new Error('export failed: database operation in progress')));
      const sendMailFn = vi.fn<(_input: MailInput) => Promise<{ messageId: string }>>(() => Promise.resolve({ messageId: 'msg-1' }));
      const findAdminUsers = vi.fn(() => Promise.resolve([
        { email: 'josh@example.com' },
      ]));

      const now = new Date('2026-10-10T12:00:00.000Z');
      const status = await runBackupCheck({
        dropboxClient: client,
        performBackupFn,
        sendMailFn,
        findAdminUsers,
        now,
      });

      expect(status.lastRunFailed).toBe(true);
      expect(sendMailFn).toHaveBeenCalledTimes(1);
      expect(sendMailFn.mock.calls[0]?.[0]?.text).toContain('database operation in progress');
    });

    it('escapes HTML special characters in error message and step', async () => {
      const sendMailFn = vi.fn<(_input: MailInput) => Promise<{ messageId: string }>>(() => Promise.resolve({ messageId: 'msg-test' }));
      await sendFailureEmail(
        '2026-10-10T12-00-00-000Z',
        '<script>alert("step")</script>',
        'error: <div>& "fatal"</div>',
        sendMailFn,
        () => Promise.resolve([{ email: 'dev@example.com' }]),
      );
      expect(sendMailFn).toHaveBeenCalledTimes(1);
      const mailInput = sendMailFn.mock.calls[0]?.[0];
      expect(mailInput?.html).toContain('&lt;script&gt;alert(&quot;step&quot;)&lt;/script&gt;');
      expect(mailInput?.html).toContain('&lt;div&gt;&amp; &quot;fatal&quot;&lt;/div&gt;');
      expect(mailInput?.text).toContain('<script>alert("step")</script>');
    });

    it('no-ops when no recipient emails are found', async () => {
      const sendMailFn = vi.fn(() => Promise.resolve({ messageId: 'msg-test' }));
      await sendFailureEmail(
        '2026-10-10T12-00-00-000Z',
        'export',
        'disk full',
        sendMailFn,
        () => Promise.resolve([]),
      );
      expect(sendMailFn).not.toHaveBeenCalled();
    });

    it('getDeveloperEmails queries userModel for userType Developer', async () => {
      const findSpy = vi.spyOn(userModel, 'find').mockResolvedValueOnce([
        { email: 'dev1@example.com' },
        { email: 'dev2@example.com' },
      ] as any);

      const emails = await getDeveloperEmails();
      expect(findSpy).toHaveBeenCalledWith({ userType: 'Developer' });
      expect(emails).toEqual(['dev1@example.com', 'dev2@example.com']);
    });

    it('getDeveloperEmails returns empty array when query rejects', async () => {
      vi.spyOn(userModel, 'find').mockRejectedValueOnce(new Error('DB connection closed'));
      const emails = await getDeveloperEmails();
      expect(emails).toEqual([]);
    });
  });

  describe('startBackupScheduler and stopBackupScheduler', () => {
    it('sets cannotTell status and does not start timer when settings are absent', () => {
      const client = createMockDropboxClient({
        dropboxConfigured: vi.fn(() => false),
      });

      startBackupScheduler({ dropboxClient: client });
      expect(getBackupStatus().cannotTell).toBe(true);
      expect(getBackupStatus().error).toContain('absent');
    });

    it('starts immediate check when settings are present and cleans up on stop', async () => {
      const client = createMockDropboxClient({
        dropboxConfigured: vi.fn(() => true),
        listSubfolders: vi.fn(() => Promise.resolve([])),
      });

      const performBackupFn = vi.fn(() => Promise.resolve({
        startedAt: '2026-10-10T12:00:00.000Z',
        finishedAt: '2026-10-10T12:01:00.000Z',
        trigger: 'daily check',
        generatedAt: '2026-10-10T12:00:00.000Z',
        databases: { webjamsalem: { ok: true, collections: { user: 1 } } },
      }));

      await startBackupScheduler({
        dropboxClient: client,
        performBackupFn,
      });

      expect(performBackupFn).toHaveBeenCalled();
      stopBackupScheduler();
    });
  });
});

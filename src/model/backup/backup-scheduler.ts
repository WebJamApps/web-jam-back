import Debug from 'debug';
import dropbox from '#src/lib/dropbox.js';
import {
  type DropboxClientLike,
  performBackup,
  type PerformBackupOptions,
  runLabel,
} from './backup-controller.js';
import type { BackupManifest } from '#src/lib/backup-export.js';
import { sendMail, type MailInput } from '#src/lib/mailer.js';
import userModel from '../user/user-facade.js';

const debug = Debug('web-jam-back:backup-scheduler');

export interface BackupStatus {
  newestGoodRun?: string;
  lastRunFailed?: boolean;
  cannotTell?: boolean;
  error?: string;
}

export interface BackupSchedulerOptions {
  dropboxClient?: DropboxClientLike;
  performBackupFn?: (opts?: PerformBackupOptions) => Promise<BackupManifest>;
  sendMailFn?: (input: MailInput) => Promise<{ messageId: string }>;
  now?: Date;
  findAdminUsers?: () => Promise<Array<{ email: string }>>;
}

let currentStatus: BackupStatus = {
  cannotTell: true,
  error: 'Check has not run yet',
};

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function getBackupStatus(): BackupStatus {
  return currentStatus;
}

export function resetBackupStatus(): void {
  currentStatus = {
    cannotTell: true,
    error: 'Check has not run yet',
  };
}

export async function getDeveloperEmails(): Promise<string[]> {
  try {
    const users = (await userModel.find({ userType: 'Developer' })) as Array<{ email?: string }>;
    return (users || [])
      .map((u) => u.email)
      .filter((e): e is string => typeof e === 'string' && !!e);
  } catch (err) {
    debug('failed to lookup Developer users: %s', (err as Error).message);
    return [];
  }
}

export function identifyFailureStep(err: unknown): string {
  if (err && typeof err === 'object' && 'step' in err && typeof (err as { step?: unknown }).step === 'string') {
    return (err as { step: string }).step;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/export/i.test(msg)) return 'export';
  if (/upload/i.test(msg)) return 'upload';
  if (/in progress|list backup folders/i.test(msg)) return 'check in progress';
  if (/settings absent/i.test(msg)) return 'settings';
  if (/prune|retention|delete/i.test(msg)) return 'retention';
  return 'backup';
}

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

export async function sendFailureEmail(
  runLabelStr: string,
  step: string,
  errorMessage: string,
  sendMailFn: (input: MailInput) => Promise<{ messageId: string }> = sendMail,
  findEmailsFn: () => Promise<Array<{ email: string }>> = async () => (await getDeveloperEmails()).map((e) => ({ email: e })),
): Promise<void> {
  const users = await findEmailsFn();
  const emails = users.map((u) => u.email).filter(Boolean);
  const to = emails.join(', ');
  if (!to) {
    debug('no Developer email found for failure alert');
    return;
  }
  const safeLabel = escapeHtml(runLabelStr);
  const safeStep = escapeHtml(step);
  const safeError = escapeHtml(errorMessage);
  const subject = `MongoDB backup failed: ${runLabelStr}`;
  const html = `<p>MongoDB backup run <b>${safeLabel}</b> failed at step <b>${safeStep}</b>.</p>`
    + `<p><b>Error:</b> ${safeError}</p>`;
  const text = `MongoDB backup run ${runLabelStr} failed at step ${step}.\n\nError: ${errorMessage}`;
  await sendMailFn({ to, subject, html, text });
}

export async function inspectDropbox(
  client: DropboxClientLike,
  accessToken: string,
): Promise<{
  newestGoodRun: string | null;
  lastRunFailed: boolean;
}> {
  const folderNames = await client.listSubfolders(accessToken, dropbox.BACKUP_ROOT);
  if (folderNames.length === 0) {
    return { newestGoodRun: null, lastRunFailed: false };
  }

  const sorted = [...folderNames].sort((a, b) => {
    const da = dropbox.parseRunDate(a);
    const db = dropbox.parseRunDate(b);
    if (da && db) return da.getTime() - db.getTime();
    return a.localeCompare(b);
  });

  const mostRecentFolder = sorted[sorted.length - 1];
  let mostRecentFailed = false;
  try {
    const mostRecentManifest = await client.readManifest(accessToken, mostRecentFolder);
    if (!dropbox.isGoodRun(mostRecentManifest)) {
      const folderDate = dropbox.parseRunDate(mostRecentFolder);
      const isUnder10Min = folderDate && (Date.now() - folderDate.getTime() < 10 * 60 * 1000);
      if (!isUnder10Min) {
        mostRecentFailed = true;
      }
    }
  } catch {
    mostRecentFailed = true;
  }

  let foundGoodTime: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const folder = sorted[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const m = await client.readManifest(accessToken, folder);
      if (dropbox.isGoodRun(m)) {
        foundGoodTime = m?.startedAt || dropbox.parseRunDate(folder)?.toISOString() || folder;
        break;
      }
    } catch {
      // ignore individual older read errors
    }
  }

  return {
    newestGoodRun: foundGoodTime,
    lastRunFailed: mostRecentFailed,
  };
}

export async function runBackupCheck(opts: BackupSchedulerOptions = {}): Promise<BackupStatus> {
  const client = opts.dropboxClient || dropbox;
  const perform = opts.performBackupFn || performBackup;
  const mailerFn = opts.sendMailFn || sendMail;
  const findUsers = opts.findAdminUsers
    || (async () => (await getDeveloperEmails()).map((e) => ({ email: e })));
  const now = opts.now || new Date();

  // 1. Settings absent: check does not run
  if (!client.dropboxConfigured()) {
    debug('Dropbox backup settings absent — backup check skipped');
    currentStatus = {
      cannotTell: true,
      error: 'Dropbox backup settings absent',
    };
    return currentStatus;
  }

  // 2. Read newest good run from Dropbox
  let newestGoodRun: string | null = null;
  let lastRunFailed = false;

  try {
    const accessToken = client.getAccessToken
      ? await client.getAccessToken()
      : await dropbox.getAccessToken();

    const inspection = await inspectDropbox(client, accessToken);
    newestGoodRun = inspection.newestGoodRun;
    lastRunFailed = inspection.lastRunFailed;
  } catch (err) {
    debug('failed to read Dropbox during backup check: %s', (err as Error).message);
    currentStatus = {
      cannotTell: true,
      error: `cannot tell: Dropbox could not be read (${(err as Error).message})`,
    };
    return currentStatus;
  }

  // 3. Determine if backup is due
  // Due when: no good run exists, or newest good run is > 24 hours old
  let backupDue = false;
  if (!newestGoodRun) {
    backupDue = true;
  } else {
    const goodDate = new Date(newestGoodRun);
    const ageMs = now.getTime() - goodDate.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      backupDue = true;
    }
  }

  if (backupDue) {
    const label = runLabel(now);
    try {
      const manifest = await perform({
        dropboxClient: client,
        trigger: 'daily check',
        now,
      });
      newestGoodRun = manifest.startedAt || label;
      lastRunFailed = false;
    } catch (err) {
      const errMsg = (err as Error).message || '';
      if (/in progress/i.test(errMsg)) {
        debug('backup check found backup due but run refused because another run is in progress: %s', errMsg);
      } else {
        lastRunFailed = true;
        const step = identifyFailureStep(err);
        await sendFailureEmail(label, step, errMsg, mailerFn, findUsers);
      }
    }
  }

  currentStatus = {
    newestGoodRun: newestGoodRun || 'none',
    lastRunFailed,
  };
  return currentStatus;
}

export function startBackupScheduler(opts: BackupSchedulerOptions = {}): Promise<BackupStatus> | void {
  /* istanbul ignore if */
  if (process.env.NODE_ENV === 'test' && !opts.dropboxClient) return undefined;

  const client = opts.dropboxClient || dropbox;
  if (!client.dropboxConfigured()) {
    debug('Dropbox backup settings absent — backup scheduler will not start');
    currentStatus = {
      cannotTell: true,
      error: 'Dropbox backup settings absent',
    };
    return undefined;
  }

  const initialCheck = runBackupCheck(opts);

  /* istanbul ignore next */
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = setInterval(() => {
    void runBackupCheck(opts);
  }, 60 * 60 * 1000);

  return initialCheck;
}

export function stopBackupScheduler(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export default {
  getBackupStatus,
  resetBackupStatus,
  runBackupCheck,
  startBackupScheduler,
  stopBackupScheduler,
  sendFailureEmail,
  identifyFailureStep,
  getDeveloperEmails,
};

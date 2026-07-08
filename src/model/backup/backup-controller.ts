import { Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Debug from 'debug';
import { runFullBackup, type BackupManifest } from '#src/lib/backup-export.js';
import dropbox from '#src/lib/dropbox.js';
import type { Icontroller } from '#src/lib/routeUtils.js';

// POST /admin/backup — weekly Mongo backup (web-jam-tools#116), triggered by the
// Deno cron app. Exports every collection of this app's own database as EJSON
// and uploads them to Dropbox, then prunes old runs. Heroku kills requests at
// 30s, so the route responds 202 immediately and the export+upload run async —
// never on the request path.
const debug = Debug('web-jam-back:backup-controller');

// Filesystem/Dropbox-safe run label: an ISO timestamp with `:`/`.` stripped, so
// plain string-sort on run labels is chronological (used by dropbox.ts retention).
export function runLabel(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function outputRoot(): string {
  return process.env.BACKUP_OUTPUT_DIR || path.join(os.tmpdir(), 'webjam-backups');
}

// The actual export + upload + prune work. Exported (not run inline in
// runBackup) so it can be invoked directly for the local mechanism drill
// without going through HTTP/auth.
export async function performBackup(): Promise<BackupManifest> {
  const label = runLabel();
  const outDir = path.join(outputRoot(), label);
  let manifest: BackupManifest | undefined;
  let uploaded = false;
  try {
    manifest = await runFullBackup(outDir);
    debug('export complete: %o', manifest.databases);
    if (dropbox.dropboxConfigured()) {
      await dropbox.uploadBackupAndPrune(outDir, label);
      uploaded = true;
      debug('uploaded backup %s to Dropbox and pruned old runs', label);
    } else {
      debug('DROPBOX_* env vars not set — export left on local disk at %s, upload skipped', outDir);
    }
  } catch (e) {
    console.error('[backup] run failed:', (e as Error).message); // eslint-disable-line no-console
  } finally {
    // Only clean up the local export once it's safely in Dropbox — otherwise
    // (Dropbox unconfigured, e.g. local dev) it's the only copy, so it stays
    // (also lets the local mechanism drill feed it straight to the restore
    // script). BACKUP_KEEP_LOCAL=true forces keeping it even after a successful
    // upload, for debugging a prod run.
    if (uploaded && process.env.BACKUP_KEEP_LOCAL !== 'true') {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }
  return manifest || { generatedAt: new Date().toISOString(), databases: {} };
}

class BackupController {
  // eslint-disable-next-line class-methods-use-this
  async runBackup(_req: Request, res: Response): Promise<unknown> {
    void performBackup();
    return res.status(202).json({ message: 'backup started' });
  }
}

export default new BackupController() as unknown as Icontroller;

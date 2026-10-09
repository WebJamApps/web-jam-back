import { Request, Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Debug from 'debug';
import { runFullBackup, type BackupManifest, type RunBackupOptions, type DbLike } from '#src/lib/backup-export.js';
import dropbox, { BACKUP_ROOT, RETAIN_RUNS, type RunFolderEntry } from '#src/lib/dropbox.js';
import type { Icontroller } from '#src/lib/routeUtils.js';

// POST /admin/backup — Mongo backup (web-jam-tools#116, web-jam-back#1141).
// Exports every collection of this app's own database as EJSON
// and uploads them to Dropbox, then prunes old runs. Heroku kills requests at
// 30s, so the route responds 202 immediately and the export+upload run async.
const debug = Debug('web-jam-back:backup-controller');

// Filesystem/Dropbox-safe run label: an ISO timestamp with `:`/`.` stripped, so
// plain string-sort on run labels is chronological (used by dropbox.ts retention).
export function runLabel(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function outputRoot(): string {
  return process.env.BACKUP_OUTPUT_DIR || path.join(os.tmpdir(), 'webjam-backups');
}

export interface DropboxClientLike {
  dropboxConfigured(): boolean;
  getAccessToken?(): Promise<string>;
  listSubfolders(accessToken: string, folderPath: string): Promise<string[]>;
  readManifest(accessToken: string, runLabel: string): Promise<BackupManifest | null>;
  uploadFile(accessToken: string, dropboxPath: string, contents: Buffer): Promise<void>;
  deletePath(accessToken: string, targetPath: string): Promise<void>;
}

export interface PerformBackupOptions {
  dropboxClient?: DropboxClientLike;
  dbOptions?: RunBackupOptions;
  db?: DbLike;
  trigger?: string;
  who?: string;
  now?: Date;
}

async function checkInProgress(
  client: DropboxClientLike,
  accessToken: string,
  now: Date,
): Promise<void> {
  let folderNames: string[];
  try {
    folderNames = await client.listSubfolders(accessToken, BACKUP_ROOT);
  } catch (e) {
    debug('failed to list backup folders: %s', (e as Error).message);
    throw new Error(`failed to list backup folders: ${(e as Error).message}`);
  }

  const TEN_MINUTES_MS = 10 * 60 * 1000;
  for (const folderName of folderNames) {
    const folderDate = dropbox.parseRunDate(folderName);
    if (!folderDate) continue;
    const age = now.getTime() - folderDate.getTime();
    if (age >= 0 && age < TEN_MINUTES_MS) {
      // eslint-disable-next-line no-await-in-loop
      const existingManifest = await client.readManifest(accessToken, folderName);
      if (!existingManifest) {
        debug('run in progress detected at %s (< 10m old with no manifest)', folderName);
        throw new Error(`backup run in progress: folder ${folderName} has no manifest`);
      }
    }
  }
}

async function uploadRunFiles(
  client: DropboxClientLike,
  accessToken: string,
  outDir: string,
  label: string,
): Promise<void> {
  const files = dropbox.listFilesRecursive(outDir);
  const dataFiles = files.filter((f) => path.basename(f) !== 'manifest.json');
  const manifestFile = files.find((f) => path.basename(f) === 'manifest.json');

  for (const file of dataFiles) {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    // eslint-disable-next-line no-await-in-loop
    await client.uploadFile(accessToken, `${BACKUP_ROOT}/${label}/${rel}`, fs.readFileSync(file));
  }
  if (manifestFile) {
    await client.uploadFile(accessToken, `${BACKUP_ROOT}/${label}/manifest.json`, fs.readFileSync(manifestFile));
  }
  debug('uploaded %d file(s) to %s/%s', files.length, BACKUP_ROOT, label);
}

async function deleteOldRuns(
  client: DropboxClientLike,
  accessToken: string,
  now: Date,
): Promise<void> {
  try {
    const allFolders = await client.listSubfolders(accessToken, BACKUP_ROOT);
    const entries: RunFolderEntry[] = [];
    for (const name of allFolders) {
      // eslint-disable-next-line no-await-in-loop
      const m = await client.readManifest(accessToken, name);
      entries.push({
        name,
        isGood: dropbox.isGoodRun(m),
        date: dropbox.parseRunDate(name),
      });
    }
    const toDelete = dropbox.foldersToPrune(entries, RETAIN_RUNS, now);
    for (const name of toDelete) {
      // eslint-disable-next-line no-await-in-loop
      await client.deletePath(accessToken, `${BACKUP_ROOT}/${name}`);
      debug('pruned backup folder %s', name);
    }
  } catch (e) {
    debug('error during retention pruning: %s', (e as Error).message);
  }
}

let activeBackup: { label: string; startedAt: Date } | null = null;

export function isBackupActive(): boolean {
  return activeBackup !== null;
}

export function resetActiveBackup(): void {
  activeBackup = null;
}

// The actual export + upload + prune work. Exported so it can be invoked
// directly without going through HTTP/auth.
export async function performBackup(opts: PerformBackupOptions = {}): Promise<BackupManifest> {
  const client = opts.dropboxClient || dropbox;

  // 1. Refuse without settings (no local-disk fallback)
  if (!client.dropboxConfigured()) {
    debug('Dropbox backup settings absent — refusing to back up');
    throw new Error('Dropbox backup settings absent');
  }

  // Active export / single-run guard: acquire run reservation before export,
  // making competing starts refuse throughout export and upload.
  if (activeBackup) {
    debug('backup run in progress: an export/upload is already active (%s)', activeBackup.label);
    throw new Error(`backup run in progress: active backup already running (${activeBackup.label})`);
  }

  const now = opts.now || new Date();
  const label = runLabel(now);
  activeBackup = { label, startedAt: now };

  try {
    const accessToken = client.getAccessToken
      ? await client.getAccessToken()
      : await dropbox.getAccessToken();

    // 2. In-progress check: refuse if folder < 10m old has no manifest;
    // refuse if folders cannot be listed.
    await checkInProgress(client, accessToken, now);

    // 3. Export configured databases; if any export fails, upload nothing and delete nothing.
    const outDir = path.join(outputRoot(), label);
    let manifest: BackupManifest;
    try {
      const dbOptions: RunBackupOptions = {
        primaryUri: opts.dbOptions?.primaryUri || (opts.db ? 'mongodb://injected-db' : undefined),
        ...(opts.dbOptions || (opts.db ? { connect: async () => ({ db: opts.db!, close: async () => {} }) } : {})),
        startedAt: now.toISOString(),
        trigger: opts.trigger || 'backup button',
        who: opts.who,
      };
      manifest = await runFullBackup(outDir, dbOptions);
    } catch (e) {
      fs.rmSync(outDir, { recursive: true, force: true });
      throw new Error(`export failed: ${(e as Error).message}`);
    }

    const allDbsOk = Object.keys(manifest.databases).length > 0
      && Object.values(manifest.databases).every((db) => db.ok);

    if (!allDbsOk) {
      debug('one or more databases failed export: %o', manifest.databases);
      fs.rmSync(outDir, { recursive: true, force: true });
      throw new Error('one or more databases failed export');
    }

    // 4. Upload files with manifest.json uploaded last
    let uploaded = false;
    try {
      await uploadRunFiles(client, accessToken, outDir, label);
      uploaded = true;
    } finally {
      if (uploaded && process.env.BACKUP_KEEP_LOCAL !== 'true') {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }

    // 5. Manifest read-back / verify good run
    let verifiedManifest: BackupManifest | null = null;
    try {
      verifiedManifest = await client.readManifest(accessToken, label);
    } catch (e) {
      debug('failed to read back manifest from Dropbox: %s', (e as Error).message);
      return manifest;
    }

    if (!dropbox.isGoodRun(verifiedManifest)) {
      debug('uploaded run was not good, refusing to delete anything');
      return manifest;
    }

    // 6. Delete only after a good run: good runs beyond newest 8, incomplete folders > 24 hours
    await deleteOldRuns(client, accessToken, now);

    return manifest;
  } finally {
    activeBackup = null;
  }
}

class BackupController {
  // eslint-disable-next-line class-methods-use-this
  async runBackup(_req: Request, res: Response): Promise<unknown> {
    if (!dropbox.dropboxConfigured()) {
      debug('Dropbox backup settings absent — refusing HTTP backup request');
      return res.status(500).json({ message: 'Dropbox backup settings absent' });
    }
    if (isBackupActive()) {
      debug('backup run in progress — refusing concurrent HTTP backup request');
      return res.status(409).json({ message: 'backup run in progress' });
    }
    performBackup().catch((e) => {
      console.error('[backup] run failed:', (e as Error).message); // eslint-disable-line no-console
    });
    return res.status(202).json({ message: 'backup started' });
  }
}

export default new BackupController() as unknown as Icontroller;

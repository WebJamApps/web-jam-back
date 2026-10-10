import { Response } from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Debug from 'debug';
import mongoose from 'mongoose';
import { runFullBackup, type BackupManifest, type RunBackupOptions, type DbLike } from '#src/lib/backup-export.js';
import dropbox, { BACKUP_ROOT, RETAIN_RUNS, type RunFolderEntry } from '#src/lib/dropbox.js';
import type { Icontroller } from '#src/lib/routeUtils.js';
import type { AuthRequest } from '#src/auth/authUtils.js';
import { buildRunSummary, type BackupRunSummary } from './backup-runs.js';
import {
  recordOperation, updateOperation, getOperation, type BackupOperation,
} from './backup-operations.js';
import {
  restoreProduction, isRestoreActive, registerDeclaredModels, mongooseIndexRebuilder,
  type RestoreDbLike,
} from './backup-restore.js';

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
  getFolderSize?(accessToken: string, folderPath: string): Promise<number | null>;
  downloadFile?(accessToken: string, dropboxPath: string): Promise<Buffer | null>;
}

// A run or operation name is one path segment; anything that could change the Dropbox path is refused.
function isSafeRunName(name: string): boolean {
  return !(name.includes('..') || name.includes('/') || name.includes('\\'));
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

export class BackupController {
  // eslint-disable-next-line class-methods-use-this
  async listRuns(_req: AuthRequest, res: Response): Promise<unknown> {
    if (!dropbox.dropboxConfigured()) {
      return res.status(500).json({ message: 'Dropbox backup settings absent' });
    }
    try {
      const accessToken = dropbox.getAccessToken
        ? await dropbox.getAccessToken()
        : await (dropbox as unknown as { getAccessToken(): Promise<string> }).getAccessToken();
      const folderNames = await dropbox.listSubfolders(accessToken, BACKUP_ROOT);
      const sorted = [...folderNames].sort((a, b) => {
        const aDate = dropbox.parseRunDate(a);
        const bDate = dropbox.parseRunDate(b);
        if (aDate && bDate) return bDate.getTime() - aDate.getTime();
        return b.localeCompare(a);
      });
      const runs: BackupRunSummary[] = [];
      for (const name of sorted) {
        // eslint-disable-next-line no-await-in-loop
        const manifest = await dropbox.readManifest(accessToken, name);
        let size: number | null = null;
        const getFolderSizeFn = (dropbox as unknown as DropboxClientLike).getFolderSize;
        if (typeof getFolderSizeFn === 'function') {
          try {
            // eslint-disable-next-line no-await-in-loop
            size = await getFolderSizeFn(accessToken, `${BACKUP_ROOT}/${name}`);
          } catch {
            size = null;
          }
        }
        runs.push(buildRunSummary(name, manifest, size));
      }
      return res.status(200).json(runs);
    } catch (e) {
      debug('failed to list backup runs: %s', (e as Error).message);
      return res.status(500).json({ message: (e as Error).message });
    }
  }

  // eslint-disable-next-line class-methods-use-this
  async startRun(req: AuthRequest, res: Response): Promise<unknown> {
    if (!dropbox.dropboxConfigured()) {
      debug('Dropbox backup settings absent — refusing HTTP backup request');
      return res.status(500).json({ message: 'Dropbox backup settings absent' });
    }
    if (isBackupActive()) {
      debug('backup run in progress — refusing concurrent HTTP backup request');
      return res.status(409).json({ message: 'backup run in progress' });
    }
    const now = new Date();
    const name = runLabel(now);
    recordOperation({
      name,
      type: 'backup',
      status: 'in_progress',
      startedAt: now.toISOString(),
      progress: 'starting',
    });
    performBackup({ who: req.user, now })
      .then((manifest) => {
        updateOperation(name, {
          status: 'completed',
          finishedAt: new Date().toISOString(),
          progress: 'complete',
          result: manifest,
        });
      })
      .catch((e) => {
        console.error('[backup] run failed:', (e as Error).message); // eslint-disable-line no-console
        updateOperation(name, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          progress: 'failed',
          error: (e as Error).message,
        });
      });
    return res.status(202).json({ name, message: 'backup started' });
  }

  // POST /admin/backup/runs/:name/restore — restores production from a chosen good run
  // behind four guards (web-jam-back#1144). Answers 202 at once; the guards run in the
  // background and the result (or the refusal) is reported through the operations route.
  // eslint-disable-next-line class-methods-use-this
  async startRestore(req: AuthRequest, res: Response): Promise<unknown> {
    const rawName = req.params?.name;
    const runName = Array.isArray(rawName) ? rawName[0] : rawName;
    if (!runName || typeof runName !== 'string' || !isSafeRunName(runName)) {
      return res.status(400).json({ message: 'a valid run name is required' });
    }
    const typedDate = (req.body as { date?: unknown } | undefined)?.date;
    if (typeof typedDate !== 'string' || !typedDate.trim()) {
      return res.status(400).json({ message: 'the run\'s date, typed as YYYY-MM-DD, is required' });
    }
    if (!dropbox.dropboxConfigured()) {
      return res.status(500).json({ message: 'Dropbox backup settings absent' });
    }
    if (isBackupActive() || isRestoreActive()) {
      return res.status(409).json({ message: 'a backup or restore is in progress' });
    }
    const { db } = mongoose.connection;
    if (!db) return res.status(500).json({ message: 'the database connection is not available' });

    const now = new Date();
    const freshBackupLabel = runLabel(now);
    const name = `restore-${freshBackupLabel}`;
    recordOperation({
      name,
      type: 'restore',
      status: 'in_progress',
      startedAt: now.toISOString(),
      progress: 'starting',
    });
    const modelRoot = path.resolve(import.meta.dirname, '..');
    const rebuild = mongooseIndexRebuilder(mongoose.connection);
    restoreProduction({
      runName,
      typedDate,
      db: db as unknown as RestoreDbLike,
      takeFreshBackup: () => performBackup({ trigger: 'restore', who: req.user, now }),
      freshBackupLabel,
      rebuildIndexes: async (collections) => {
        await registerDeclaredModels(modelRoot);
        await rebuild(collections);
      },
      onProgress: (progress) => { updateOperation(name, { progress }); },
    })
      .then((result) => {
        updateOperation(name, {
          status: 'completed',
          finishedAt: new Date().toISOString(),
          progress: 'complete',
          result,
        });
      })
      .catch((e) => {
        console.error('[restore] failed:', (e as Error).message); // eslint-disable-line no-console
        updateOperation(name, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          progress: 'failed',
          error: (e as Error).message,
        });
      });
    return res.status(202).json({ name, message: 'restore started' });
  }

  // eslint-disable-next-line class-methods-use-this
  async getOperation(req: AuthRequest, res: Response): Promise<unknown> {
    const rawName = req.params?.name;
    const name = Array.isArray(rawName) ? rawName[0] : rawName;
    if (!name || typeof name !== 'string') return res.status(400).json({ message: 'operation name is required' });
    if (!isSafeRunName(name)) {
      return res.status(400).json({ message: 'invalid operation name' });
    }
    const op = getOperation(name);
    if (op) {
      return res.status(200).json(op);
    }
    if (dropbox.dropboxConfigured()) {
      try {
        const accessToken = await dropbox.getAccessToken();
        const manifest = await dropbox.readManifest(accessToken, name);
        if (manifest) {
          const fallbackOp: BackupOperation = {
            name,
            type: 'backup',
            status: dropbox.isGoodRun(manifest) ? 'completed' : 'failed',
            startedAt: manifest.startedAt || name,
            finishedAt: manifest.finishedAt || null,
            progress: 'complete',
            result: manifest,
          };
          return res.status(200).json(fallbackOp);
        }
      } catch (err) {
        return res.status(500).json({ message: (err as Error).message });
      }
    }
    return res.status(404).json({ message: `operation '${name}' not found` });
  }

  // eslint-disable-next-line class-methods-use-this
  async runBackup(req: AuthRequest, res: Response): Promise<unknown> {
    if (!dropbox.dropboxConfigured()) {
      debug('Dropbox backup settings absent — refusing HTTP backup request');
      return res.status(500).json({ message: 'Dropbox backup settings absent' });
    }
    if (isBackupActive()) {
      debug('backup run in progress — refusing concurrent HTTP backup request');
      return res.status(409).json({ message: 'backup run in progress' });
    }
    const now = new Date();
    const name = runLabel(now);
    recordOperation({
      name,
      type: 'backup',
      status: 'in_progress',
      startedAt: now.toISOString(),
      progress: 'starting',
    });
    performBackup({ who: req.user, now })
      .then((manifest) => {
        updateOperation(name, {
          status: 'completed',
          finishedAt: new Date().toISOString(),
          progress: 'complete',
          result: manifest,
        });
      })
      .catch((e) => {
        console.error('[backup] run failed:', (e as Error).message); // eslint-disable-line no-console
        updateOperation(name, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          progress: 'failed',
          error: (e as Error).message,
        });
      });
    return res.status(202).json({ message: 'backup started' });
  }
}

export default new BackupController() as unknown as BackupController & Icontroller;

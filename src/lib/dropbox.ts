import fs from 'fs';
import path from 'path';
import Debug from 'debug';
import type { BackupManifest } from '#src/lib/backup-export.js';

// Dropbox upload for the Mongo backup (web-jam-tools#116, web-jam-back#1141).
// Uses the refresh-token flow via plain fetch against the Dropbox HTTP API.
const debug = Debug('web-jam-back:dropbox');

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
const LIST_FOLDER_URL = 'https://api.dropboxapi.com/2/files/list_folder';
const DELETE_URL = 'https://api.dropboxapi.com/2/files/delete_v2';

// All backup runs live under this folder, one subfolder per run (named with the
// run's timestamp label so string-sorting = chronological order).
export const BACKUP_ROOT = '/webjam-backups';
// Retention: keep the newest 8 good run-folders; Dropbox's own version history
// covers deeper time travel if ever needed.
export const RETAIN_RUNS = 8;

export function dropboxConfigured(): boolean {
  return !!(
    process.env.BACKUP_DROPBOX_APP_KEY
    && process.env.BACKUP_DROPBOX_APP_SECRET
    && process.env.BACKUP_DROPBOX_REFRESH_TOKEN
  );
}

interface TokenResponse { access_token?: string }

export async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.BACKUP_DROPBOX_REFRESH_TOKEN || '',
    client_id: process.env.BACKUP_DROPBOX_APP_KEY || '',
    client_secret: process.env.BACKUP_DROPBOX_APP_SECRET || '',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!res.ok) throw new Error(`dropbox token exchange failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as TokenResponse;
  if (!body || !body.access_token) throw new Error('dropbox token exchange returned no access_token');
  return body.access_token;
}

export async function uploadFile(accessToken: string, dropboxPath: string, contents: Buffer): Promise<void> {
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', mute: true }),
    },
    body: contents as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`dropbox upload failed for ${dropboxPath}: ${res.status} ${res.statusText}`);
}

interface DropboxErrorPayload {
  error_summary?: string;
  error?: {
    '.tag'?: string;
    path?: {
      '.tag'?: string;
    } | string;
    [key: string]: unknown;
  };
}

export function isDropboxNotFoundError(payload: unknown, rawText?: string): boolean {
  if (typeof payload === 'object' && payload !== null) {
    const err = payload as DropboxErrorPayload;
    if (typeof err.error_summary === 'string' && err.error_summary.startsWith('path/not_found')) {
      return true;
    }
    if (typeof err.error?.path === 'object' && err.error.path !== null && err.error.path['.tag'] === 'not_found') {
      return true;
    }
    if (err.error?.['.tag'] === 'not_found') {
      return true;
    }
  }
  if (typeof rawText === 'string') {
    const trimmed = rawText.trim();
    if (trimmed.startsWith('path/not_found')) return true;
    try {
      const parsed = JSON.parse(trimmed) as DropboxErrorPayload;
      return isDropboxNotFoundError(parsed);
    } catch {
      // not JSON
    }
  }
  return false;
}

type ResponseWithBody = { text?: () => Promise<string>; json?: () => Promise<unknown> };

async function inspectDropbox409(res: ResponseWithBody): Promise<{ isNotFound: boolean; detail: string }> {
  let text = '';
  try {
    if (typeof res.text === 'function') {
      text = await res.text();
    } else if (typeof res.json === 'function') {
      const j = await res.json();
      text = typeof j === 'string' ? j : JSON.stringify(j);
    }
  } catch {
    text = '';
  }
  if (!text) return { isNotFound: false, detail: '' };

  try {
    const json = JSON.parse(text) as DropboxErrorPayload;
    const isNotFound = isDropboxNotFoundError(json);
    const detail = json.error_summary || text;
    return { isNotFound, detail };
  } catch {
    const isNotFound = isDropboxNotFoundError(null, text);
    return { isNotFound, detail: text };
  }
}

export async function downloadFile(accessToken: string, dropboxPath: string): Promise<Buffer | null> {
  const res = await fetch(DOWNLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
    },
  });
  if (res.status === 409) {
    const { isNotFound, detail } = await inspectDropbox409(res);
    if (isNotFound) return null;
    const suffix = detail ? ` (${detail})` : '';
    throw new Error(`dropbox download failed for ${dropboxPath}: 409 ${res.statusText}${suffix}`);
  }
  if (!res.ok) throw new Error(`dropbox download failed for ${dropboxPath}: ${res.status} ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function readManifest(accessToken: string, runLabel: string): Promise<BackupManifest | null> {
  const manifestPath = `${BACKUP_ROOT}/${runLabel}/manifest.json`;
  const buf = await downloadFile(accessToken, manifestPath);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8')) as BackupManifest;
  } catch (e) {
    throw new Error(`failed to parse manifest for ${runLabel}: ${(e as Error).message}`);
  }
}

export function isGoodRun(manifest: BackupManifest | null | undefined): boolean {
  if (!manifest || !manifest.databases) return false;
  const dbs = Object.values(manifest.databases);
  if (dbs.length === 0) return false;
  return dbs.every((db) => db.ok === true);
}

export function parseRunDate(label: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})[-:](\d{2})[-.](\d{3})Z$/.exec(label);
  if (match) {
    const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date(label);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

interface ListFolderEntry { '.tag': string; name: string }
interface ListFolderResponse { entries?: ListFolderEntry[] }

// Names of the direct subfolders of `folderPath`. Returns [] (not an error) the
// first time a backup ever runs, before /webjam-backups exists (Dropbox 409s
// path/not_found in that case).
export async function listSubfolders(accessToken: string, folderPath: string): Promise<string[]> {
  const res = await fetch(LIST_FOLDER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  });
  if (res.status === 409) {
    const { isNotFound, detail } = await inspectDropbox409(res);
    if (isNotFound) return [];
    const suffix = detail ? ` (${detail})` : '';
    throw new Error(`dropbox list_folder failed: 409 ${res.statusText}${suffix}`);
  }
  if (!res.ok) throw new Error(`dropbox list_folder failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as ListFolderResponse;
  return (body.entries || []).filter((e) => e['.tag'] === 'folder').map((e) => e.name);
}

// Sums the size of all files in folderPath. Returns 0 if folder does not exist.
export async function getFolderSize(accessToken: string, folderPath: string): Promise<number> {
  const res = await fetch(LIST_FOLDER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: folderPath, recursive: true }),
  });
  if (res.status === 409) return 0;
  if (!res.ok) throw new Error(`dropbox list_folder failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as { entries?: Array<{ '.tag': string; size?: number }> };
  return (body.entries || []).reduce((acc, e) => acc + (e['.tag'] === 'file' ? (e.size || 0) : 0), 0);
}

export async function deletePath(accessToken: string, targetPath: string): Promise<void> {
  const res = await fetch(DELETE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  if (!res.ok) throw new Error(`dropbox delete failed for ${targetPath}: ${res.status} ${res.statusText}`);
}

export interface RunFolderEntry {
  name: string;
  isGood: boolean;
  date?: Date | null;
}

// Pure retention logic:
// - Keeps the newest `keep` (default 8) good runs; prunes good runs beyond newest 8.
// - Prunes incomplete run folders older than 24 hours.
// - Supports legacy string[] input for backward compatibility (assumes all are good).
export function foldersToPrune(
  runs: string[] | RunFolderEntry[],
  keep: number = RETAIN_RUNS,
  now: Date = new Date(),
): string[] {
  if (runs.length === 0) return [];
  if (typeof runs[0] === 'string') {
    const sorted = [...(runs as string[])].sort();
    const excess = sorted.length - keep;
    return excess > 0 ? sorted.slice(0, excess) : [];
  }
  const entries = runs as RunFolderEntry[];
  const toPrune: string[] = [];
  const oneDayMs = 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  for (const entry of entries) {
    if (entry.isGood) continue;
    const entryDate = entry.date || parseRunDate(entry.name);
    if (entryDate && (nowMs - entryDate.getTime() > oneDayMs)) {
      toPrune.push(entry.name);
    }
  }

  const goodRuns = entries.filter((e) => e.isGood);
  goodRuns.sort((a, b) => {
    const aDate = a.date || parseRunDate(a.name);
    const bDate = b.date || parseRunDate(b.name);
    if (aDate && bDate) return aDate.getTime() - bDate.getTime();
    return a.name.localeCompare(b.name);
  });
  const excessGood = goodRuns.length - keep;
  if (excessGood > 0) {
    for (let i = 0; i < excessGood; i += 1) {
      toPrune.push(goodRuns[i].name);
    }
  }

  return toPrune;
}

export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

// Uploads every file under localDir (recursively) with manifest.json uploaded
// last to `${BACKUP_ROOT}/${runLabel}/<relative path>`. Then, if the uploaded run
// is verified good, prunes runs according to the retention rules.
export async function uploadBackupAndPrune(localDir: string, runLabel: string): Promise<void> {
  const accessToken = await getAccessToken();
  const files = listFilesRecursive(localDir);
  const dataFiles = files.filter((f) => path.basename(f) !== 'manifest.json');
  const manifestFile = files.find((f) => path.basename(f) === 'manifest.json');

  for (const file of dataFiles) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    // eslint-disable-next-line no-await-in-loop
    await uploadFile(accessToken, `${BACKUP_ROOT}/${runLabel}/${rel}`, fs.readFileSync(file));
  }
  if (manifestFile) {
    await uploadFile(accessToken, `${BACKUP_ROOT}/${runLabel}/manifest.json`, fs.readFileSync(manifestFile));
  }
  debug('uploaded %d file(s) to %s/%s', files.length, BACKUP_ROOT, runLabel);

  const readBack = await readManifest(accessToken, runLabel);
  if (!isGoodRun(readBack)) {
    debug('run %s manifest read-back was not good, skipping deletion', runLabel);
    return;
  }

  const names = await listSubfolders(accessToken, BACKUP_ROOT);
  const entries: RunFolderEntry[] = [];
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const m = await readManifest(accessToken, name);
    entries.push({
      name,
      isGood: isGoodRun(m),
      date: parseRunDate(name),
    });
  }
  const toPrune = foldersToPrune(entries);
  for (const name of toPrune) {
    // eslint-disable-next-line no-await-in-loop
    await deletePath(accessToken, `${BACKUP_ROOT}/${name}`);
    debug('pruned old backup folder %s', name);
  }
}

export default {
  BACKUP_ROOT,
  RETAIN_RUNS,
  dropboxConfigured,
  getAccessToken,
  uploadFile,
  downloadFile,
  readManifest,
  listSubfolders,
  getFolderSize,
  deletePath,
  foldersToPrune,
  isGoodRun,
  isDropboxNotFoundError,
  parseRunDate,
  listFilesRecursive,
  uploadBackupAndPrune,
};

import fs from 'fs';
import path from 'path';
import Debug from 'debug';

// Dropbox upload for the weekly Mongo backup (web-jam-tools#116). Uses the
// refresh-token flow (long-lived tokens are deprecated) via plain fetch against
// the Dropbox HTTP API — mirrors src/lib/calendar.ts's style (no SDK dependency
// needed for a handful of endpoints).
const debug = Debug('web-jam-back:dropbox');

const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const LIST_FOLDER_URL = 'https://api.dropboxapi.com/2/files/list_folder';
const DELETE_URL = 'https://api.dropboxapi.com/2/files/delete_v2';

// All backup runs live under this folder, one subfolder per run (named with the
// run's timestamp label so string-sorting = chronological order).
export const BACKUP_ROOT = '/webjam-backups';
// Retention: keep the newest 8 run-folders (web-jam-tools#116); Dropbox's own
// version history covers deeper time travel if ever needed.
export const RETAIN_RUNS = 8;

export function dropboxConfigured(): boolean {
  return !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

interface TokenResponse { access_token?: string }

async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN || '',
    client_id: process.env.DROPBOX_APP_KEY || '',
    client_secret: process.env.DROPBOX_APP_SECRET || '',
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
  if (res.status === 409) return [];
  if (!res.ok) throw new Error(`dropbox list_folder failed: ${res.status} ${res.statusText}`);
  const body = await res.json() as ListFolderResponse;
  return (body.entries || []).filter((e) => e['.tag'] === 'folder').map((e) => e.name);
}

export async function deletePath(accessToken: string, targetPath: string): Promise<void> {
  const res = await fetch(DELETE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: targetPath }),
  });
  if (!res.ok) throw new Error(`dropbox delete failed for ${targetPath}: ${res.status} ${res.statusText}`);
}

// Pure retention logic: which run-folder names (out of ALL of them) are older
// than the newest `keep`. Run-folder names are lexicographically-sortable
// timestamps, so a plain string sort orders oldest-first. Pure + injectable —
// unit-tested directly with plain string arrays, no Dropbox/network involved.
export function foldersToPrune(names: string[], keep: number = RETAIN_RUNS): string[] {
  const sorted = [...names].sort();
  const excess = sorted.length - keep;
  return excess > 0 ? sorted.slice(0, excess) : [];
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

// Uploads every file under localDir (recursively) to
// `${BACKUP_ROOT}/${runLabel}/<relative path>`, then prunes run-folders beyond
// the newest RETAIN_RUNS.
export async function uploadBackupAndPrune(localDir: string, runLabel: string): Promise<void> {
  const accessToken = await getAccessToken();
  const files = listFilesRecursive(localDir);
  for (const file of files) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    // eslint-disable-next-line no-await-in-loop
    await uploadFile(accessToken, `${BACKUP_ROOT}/${runLabel}/${rel}`, fs.readFileSync(file));
  }
  debug('uploaded %d file(s) to %s/%s', files.length, BACKUP_ROOT, runLabel);

  const names = await listSubfolders(accessToken, BACKUP_ROOT);
  const toPrune = foldersToPrune(names);
  for (const name of toPrune) {
    // eslint-disable-next-line no-await-in-loop
    await deletePath(accessToken, `${BACKUP_ROOT}/${name}`);
    debug('pruned old backup folder %s', name);
  }
}

export default {
  dropboxConfigured, uploadFile, listSubfolders, deletePath, foldersToPrune, uploadBackupAndPrune,
};

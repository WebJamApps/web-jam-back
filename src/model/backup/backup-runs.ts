import type { BackupManifest, DbExportResult } from '#src/lib/backup-export.js';
import dropbox, { BACKUP_ROOT } from '#src/lib/dropbox.js';

export type RunState = 'good' | 'incomplete' | 'failed';

export function classifyManifest(manifest: BackupManifest | null | undefined): RunState {
  if (!manifest) {
    return 'incomplete';
  }
  if (!manifest.databases || Object.keys(manifest.databases).length === 0) {
    return 'incomplete';
  }
  const dbs = Object.values(manifest.databases);
  const anyFailed = dbs.some((db) => db.ok === false || Boolean(db.reason));
  if (anyFailed) {
    return 'failed';
  }
  const allGood = dbs.every((db) => db.ok === true);
  if (allGood) {
    return 'good';
  }
  return 'incomplete';
}

export interface BackupRunSummary {
  name: string;
  startTime: string | null;
  startedAt: string | null;
  trigger: string | null;
  state: RunState;
  size: number;
  dropboxPath: string;
  path: string;
  collections: Record<string, Record<string, number>>;
  databases: Record<string, DbExportResult>;
}

export function buildRunSummary(
  folderName: string,
  manifest: BackupManifest | null | undefined,
  size = 0,
): BackupRunSummary {
  const state = classifyManifest(manifest);
  const collections: Record<string, Record<string, number>> = {};
  if (manifest?.databases) {
    for (const [dbName, dbResult] of Object.entries(manifest.databases)) {
      collections[dbName] = dbResult.collections || {};
    }
  }

  const startTime = manifest?.startedAt
    || dropbox.parseRunDate(folderName)?.toISOString()
    || null;

  const dropboxPath = `${BACKUP_ROOT}/${folderName}`;

  return {
    name: folderName,
    startTime,
    startedAt: startTime,
    trigger: manifest?.trigger || null,
    state,
    size,
    dropboxPath,
    path: dropboxPath,
    collections,
    databases: manifest?.databases || {},
  };
}

export default {
  classifyManifest,
  buildRunSummary,
};

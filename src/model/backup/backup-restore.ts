import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { pathToFileURL } from 'url';
import Debug from 'debug';
import mongoose from 'mongoose';
import dropbox, { BACKUP_ROOT } from '#src/lib/dropbox.js';
import type { BackupManifest } from '#src/lib/backup-export.js';

// Restore of a chosen backup run (web-jam-tools#1083, web-jam-back#1144).
// One module, two callers: POST /admin/backup/runs/:name/restore (the production
// backend, behind four guards) and scripts/restore-backup.mjs (a local folder).
// A restore is a REPLACEMENT, not a merge: each collection in the backup is
// dropped and re-created from its file. Collections absent from the backup are
// left alone.
const debug = Debug('web-jam-back:backup-restore');

// mongoose re-exports the driver's BSON module, so EJSON needs no new dependency.
const { EJSON } = mongoose.mongo.BSON;

const DATABASE = 'webjamsalem';
const BATCH_SIZE = 1000;

// A guard refused the restore. Thrown only before anything is changed.
export class RestoreRefusal extends Error {
  guard: string;

  constructor(guard: string, message: string) {
    super(message);
    this.name = 'RestoreRefusal';
    this.guard = guard;
  }
}

// The slice of the Dropbox client a restore needs.
export interface RestoreDropboxLike {
  getAccessToken?(): Promise<string>;
  readManifest(accessToken: string, runLabel: string): Promise<BackupManifest | null>;
  downloadFile?(accessToken: string, dropboxPath: string): Promise<Buffer | null>;
}

// The slice of a Mongo `Db` a restore needs, so tests can inject an in-memory fake.
export interface RestoreCollectionLike {
  insertMany(docs: Record<string, unknown>[], opts?: { ordered?: boolean }): Promise<{ insertedCount: number }>;
  indexes(): Promise<Array<{ name?: string }>>;
}
export interface RestoreDbLike {
  listCollections(): { toArray(): Promise<{ name: string }[]> };
  collection(name: string): RestoreCollectionLike;
  dropCollection(name: string): Promise<unknown>;
}

// A per-document hook for one-off migrations (web-jam-tools#897): returns the
// document (same collection), null/undefined (dropped), or { collection, doc }
// (redirected into another collection).
export type RestoreTransform = (doc: Record<string, unknown>, collectionName: string) => unknown;

// An index the record definitions declare that could not be built (for example a unique
// index over restored data that repeats a value). The data is already replaced when this
// is known, so it is reported in the result rather than thrown.
export interface IndexFailure {
  collection: string;
  message: string;
}

export type RebuildIndexes = (collections: string[]) => Promise<IndexFailure[] | void>;

export interface RestoredCollection {
  collection: string;
  restored: number;
  manifest: number | null;
}

export interface MissingIndex {
  collection: string;
  index: string;
}

export interface RestoreResult {
  collections: RestoredCollection[];
  missingIndexes: MissingIndex[];
  indexFailures: IndexFailure[];
}

// ── Files ────────────────────────────────────────────────────────────────────

async function* readLines(file: string): AsyncGenerator<string> {
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim().length > 0) yield line;
    }
  } finally {
    lines.close();
  }
}

async function countRecords(file: string): Promise<number> {
  let count = 0;
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.trim().length > 0) count += 1;
    }
  } finally {
    lines.close();
  }
  return count;
}

// Guard 4 (files): every file the manifest names must be readable and hold exactly
// the number of records the manifest says. Any difference refuses, nothing changed.
export async function verifyFolderCounts(folder: string, manifestCounts: Record<string, number>): Promise<void> {
  for (const [name, expected] of Object.entries(manifestCounts)) {
    const file = path.join(folder, `${name}.ndjson`);
    let actual: number;
    try {
      // eslint-disable-next-line no-await-in-loop
      actual = await countRecords(file);
    } catch (e) {
      throw new RestoreRefusal('files', `cannot read ${name}.ndjson: ${(e as Error).message}`);
    }
    if (actual !== expected) {
      throw new RestoreRefusal('files', `${name}.ndjson holds ${actual} records but the manifest says ${expected}`);
    }
  }
}

// Every record in every file must parse, and parse to a document, before any collection is
// dropped; anything else (malformed JSON, null, a scalar, an array) refuses the restore with
// nothing changed.
async function validateRecords(folder: string, files: string[]): Promise<void> {
  for (const file of files) {
    let lineNumber = 0;
    try {
      // eslint-disable-next-line no-await-in-loop
      for await (const line of readLines(path.join(folder, file))) {
        lineNumber += 1;
        const parsed: unknown = EJSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new TypeError('the record is not a document');
        }
      }
    } catch (e) {
      throw new RestoreRefusal('files', `${file} holds a record that is not a valid document (record ${lineNumber}): ${(e as Error).message}`);
    }
  }
}

// ── Indexes ──────────────────────────────────────────────────────────────────

async function snapshotIndexes(db: RestoreDbLike, collections: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const name of collections) {
    try {
      // eslint-disable-next-line no-await-in-loop
      out[name] = (await db.collection(name).indexes()).map((i) => i.name || '').filter((n) => n && n !== '_id_');
    } catch {
      out[name] = []; // the collection does not exist
    }
  }
  return out;
}

// Rebuilds the indexes the record definitions (Mongoose schemas) declare, on the
// given connection, for the collections that were just replaced.
/* istanbul ignore next */
export function mongooseIndexRebuilder(conn: mongoose.Connection): RebuildIndexes {
  return async (collections) => {
    const failures: IndexFailure[] = [];
    for (const modelName of mongoose.modelNames()) {
      const base = mongoose.model(modelName);
      const collectionName = base.collection.collectionName;
      if (!collections.includes(collectionName)) continue;
      const model = conn === mongoose.connection
        ? base
        : (conn.models[modelName] ?? conn.model(modelName, base.schema, collectionName));
      try {
        // eslint-disable-next-line no-await-in-loop
        await model.createIndexes();
      } catch (e) {
        failures.push({ collection: collectionName, message: (e as Error).message });
      }
    }
    return failures;
  };
}

// Imports every *-schema module under `modelRoot` so all declared models are registered
// (the production backend already has them; the command-line script does not).
export async function registerDeclaredModels(modelRoot: string): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(full);
      } else if (/-schema\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        // eslint-disable-next-line no-await-in-loop
        await import(pathToFileURL(full).href);
      }
    }
  };
  await walk(modelRoot);
}

// ── Replacement ──────────────────────────────────────────────────────────────

function isNamespaceNotFound(e: unknown): boolean {
  const err = e as { code?: number; codeName?: string; message?: string };
  return err.code === 26 || err.codeName === 'NamespaceNotFound' || /ns not found/i.test(err.message || '');
}

async function dropIfPresent(db: RestoreDbLike, name: string): Promise<void> {
  try {
    await db.dropCollection(name);
  } catch (e) {
    if (!isNamespaceNotFound(e)) throw e; // a drop that failed must not become a merge
  }
}

// Only the return value of an explicitly supplied transform may redirect a document;
// a stored document that happens to have `doc` and `collection` fields is just a document.
function destinationOf(result: unknown, source: string, transformed: boolean): { name: string; doc: Doc } {
  const redirect = transformed && typeof result === 'object' && result !== null && !Array.isArray(result)
    && 'doc' in result && 'collection' in result;
  if (redirect) {
    const r = result as { collection: string; doc: Doc };
    return { name: r.collection, doc: r.doc };
  }
  return { name: source, doc: result as Doc };
}

type Doc = Record<string, unknown>;

interface RestoreContext {
  db: RestoreDbLike;
  transform?: RestoreTransform;
  restored: Map<string, number>; // destination -> documents inserted
}

// A destination is dropped once, when a document first reaches it.
async function touch(ctx: RestoreContext, dest: string): Promise<void> {
  if (ctx.restored.has(dest)) return;
  await dropIfPresent(ctx.db, dest);
  ctx.restored.set(dest, 0);
}

async function flushBatch(ctx: RestoreContext, batch: Map<string, Doc[]>): Promise<void> {
  for (const [dest, docs] of batch) {
    // eslint-disable-next-line no-await-in-loop
    const { insertedCount } = await ctx.db.collection(dest).insertMany(docs, { ordered: false });
    ctx.restored.set(dest, (ctx.restored.get(dest) || 0) + insertedCount);
  }
  batch.clear();
}

async function restoreOneFile(ctx: RestoreContext, folder: string, file: string): Promise<void> {
  const source = file.replace(/\.ndjson$/, '');
  const batch = new Map<string, Doc[]>();
  let pending = 0;
  let sawRecord = false;
  for await (const line of readLines(path.join(folder, file))) {
    sawRecord = true;
    const doc = EJSON.parse(line) as Doc;
    const result = ctx.transform ? ctx.transform(doc, source) : doc;
    if (result !== null && result !== undefined) {
      const target = destinationOf(result, source, !!ctx.transform);
      // eslint-disable-next-line no-await-in-loop
      await touch(ctx, target.name);
      batch.set(target.name, [...(batch.get(target.name) || []), target.doc]);
      pending += 1;
    }
    if (pending >= BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      await flushBatch(ctx, batch);
      pending = 0;
    }
  }
  if (!sawRecord) await touch(ctx, source); // an empty file replaces the collection with an empty one
  await flushBatch(ctx, batch);
  debug('restored %s', source);
}

export interface ReplaceOptions {
  db: RestoreDbLike;
  // Folder holding one database's `<collection>.ndjson` files.
  folder: string;
  // `<collection> -> count` from the run's manifest, for the side-by-side result.
  manifestCounts?: Record<string, number>;
  transform?: RestoreTransform;
  rebuildIndexes?: RebuildIndexes;
  onProgress?: (step: string) => void;
}

function missingIndexesOf(before: Record<string, string[]>, after: Record<string, string[]>): MissingIndex[] {
  const missing: MissingIndex[] = [];
  for (const [collection, names] of Object.entries(before)) {
    const kept = new Set(after[collection] || []);
    missing.push(...names.filter((index) => !kept.has(index)).map((index) => ({ collection, index })));
  }
  return missing;
}

// Drops and re-creates each collection found in `folder`, rebuilds the declared
// indexes, and reports restored counts beside manifest counts plus any index that
// existed before and is gone after.
export async function replaceFromFolder(opts: ReplaceOptions): Promise<RestoreResult> {
  const { db, folder, manifestCounts, transform } = opts;
  const progress = opts.onProgress || (() => undefined);
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.ndjson')).sort();

  await validateRecords(folder, files);

  const before = await snapshotIndexes(db, (await db.listCollections().toArray()).map((c) => c.name));

  progress('replacing collections');
  const ctx: RestoreContext = { db, transform, restored: new Map() };
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    await restoreOneFile(ctx, folder, file);
  }

  progress('rebuilding indexes');
  const indexFailures = (opts.rebuildIndexes && await opts.rebuildIndexes([...ctx.restored.keys()])) || [];

  const after = await snapshotIndexes(db, Object.keys(before));
  const collections: RestoredCollection[] = [...ctx.restored].map(([collection, count]) => ({
    collection,
    restored: count,
    manifest: manifestCounts?.[collection] ?? null,
  }));
  return { collections, missingIndexes: missingIndexesOf(before, after), indexFailures };
}

// The command-line script's entry: checks the files against the manifest's counts
// (when the run folder has a manifest), then replaces.
export async function restoreFromFolder(opts: ReplaceOptions): Promise<RestoreResult> {
  if (opts.manifestCounts) await verifyFolderCounts(opts.folder, opts.manifestCounts);
  return replaceFromFolder(opts);
}

// ── Production restore (the four guards) ─────────────────────────────────────

let restoreActive = false;

export function isRestoreActive(): boolean {
  return restoreActive;
}

export function resetRestoreActive(): void {
  restoreActive = false;
}

// The date a run's folder name carries, as typed: YYYY-MM-DD in UTC.
export function runDateOf(runName: string): string | null {
  const date = dropbox.parseRunDate(runName);
  return date ? date.toISOString().slice(0, 10) : null;
}

export interface RestoreProductionOptions {
  runName: string;
  typedDate: string;
  dropboxClient?: RestoreDropboxLike;
  db: RestoreDbLike;
  // Takes the fresh backup of production as it stands (guard 3) and reports its label.
  takeFreshBackup: () => Promise<BackupManifest>;
  freshBackupLabel: string;
  rebuildIndexes?: RebuildIndexes;
  scratchDir?: string;
  onProgress?: (step: string) => void;
}

async function accessTokenOf(client: RestoreDropboxLike): Promise<string> {
  return client.getAccessToken ? client.getAccessToken() : dropbox.getAccessToken();
}

// Guard 1: only a good run can be chosen.
async function checkChosenRun(client: RestoreDropboxLike, token: string, runName: string): Promise<BackupManifest> {
  let manifest: BackupManifest | null;
  try {
    manifest = await client.readManifest(token, runName);
  } catch (e) {
    throw new RestoreRefusal('run', `the manifest of ${runName} cannot be read: ${(e as Error).message}`);
  }
  if (!manifest) throw new RestoreRefusal('run', `${runName} has no manifest, so it is not a good run`);
  if (!dropbox.isGoodRun(manifest)) throw new RestoreRefusal('run', `${runName} is not a good run`);
  return manifest;
}

// Guard 2: the typed date must match the chosen run's date.
function checkTypedDate(runName: string, typedDate: string): void {
  const runDate = runDateOf(runName);
  if (!runDate) throw new RestoreRefusal('date', `the date of ${runName} cannot be determined`);
  if (typedDate.trim() !== runDate) {
    throw new RestoreRefusal('date', `the typed date ${typedDate} does not match the run's date ${runDate}`);
  }
}

// Guard 3: a fresh backup of production is taken first and read back as good.
async function checkFreshBackup(
  client: RestoreDropboxLike,
  token: string,
  opts: RestoreProductionOptions,
): Promise<void> {
  try {
    await opts.takeFreshBackup();
  } catch (e) {
    throw new RestoreRefusal('fresh backup', `the fresh backup failed: ${(e as Error).message}`);
  }
  let readBack: BackupManifest | null;
  try {
    readBack = await client.readManifest(token, opts.freshBackupLabel);
  } catch (e) {
    throw new RestoreRefusal('fresh backup', `the fresh backup cannot be read back: ${(e as Error).message}`);
  }
  if (!dropbox.isGoodRun(readBack)) {
    throw new RestoreRefusal('fresh backup', 'the fresh backup was not read back as a good run');
  }
}

// Guard 4: download the chosen run's files and compare each count with the manifest.
async function downloadAndVerify(
  client: RestoreDropboxLike,
  token: string,
  runName: string,
  counts: Record<string, number>,
  dest: string,
): Promise<void> {
  if (!client.downloadFile) throw new RestoreRefusal('files', 'this Dropbox client cannot download files');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of Object.keys(counts)) {
    let contents: Buffer | null;
    try {
      // eslint-disable-next-line no-await-in-loop
      contents = await client.downloadFile(token, `${BACKUP_ROOT}/${runName}/${DATABASE}/${name}.ndjson`);
    } catch (e) {
      throw new RestoreRefusal('files', `cannot download ${name}.ndjson: ${(e as Error).message}`);
    }
    if (!contents) throw new RestoreRefusal('files', `${name}.ndjson is missing from ${runName}`);
    fs.writeFileSync(path.join(dest, `${name}.ndjson`), contents);
  }
  await verifyFolderCounts(dest, counts);
}

// Restores production from the chosen run. Every guard runs, and refuses with
// nothing changed, before the first collection is dropped.
export async function restoreProduction(opts: RestoreProductionOptions): Promise<RestoreResult> {
  const client: RestoreDropboxLike = opts.dropboxClient || dropbox;
  const progress = opts.onProgress || (() => undefined);
  if (restoreActive) throw new RestoreRefusal('in progress', 'a restore is already running');
  restoreActive = true;
  const scratch = opts.scratchDir || path.join(os.tmpdir(), `webjam-restore-${opts.runName}`);
  try {
    const token = await accessTokenOf(client);

    progress('checking the chosen run');
    const manifest = await checkChosenRun(client, token, opts.runName);

    progress('checking the typed date');
    checkTypedDate(opts.runName, opts.typedDate);

    // The files are downloaded before the fresh backup is taken: the fresh backup prunes
    // to the newest eight good runs and could otherwise delete the oldest run just chosen.
    progress('downloading and checking the run files');
    const counts = manifest.databases[DATABASE]?.collections;
    if (!counts) throw new RestoreRefusal('files', `${opts.runName} holds no ${DATABASE} collections`);
    await downloadAndVerify(client, token, opts.runName, counts, scratch);

    progress('taking a fresh backup of production');
    await checkFreshBackup(client, token, opts);

    return await replaceFromFolder({
      db: opts.db,
      folder: scratch,
      manifestCounts: counts,
      rebuildIndexes: opts.rebuildIndexes,
      onProgress: progress,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    restoreActive = false;
  }
}

export default {
  restoreProduction,
  restoreFromFolder,
  replaceFromFolder,
  verifyFolderCounts,
  registerDeclaredModels,
  mongooseIndexRebuilder,
  runDateOf,
  isRestoreActive,
  resetRestoreActive,
};

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import Debug from 'debug';

const debug = Debug('web-jam-back:backup-export');

// mongoose re-exports the driver's BSON module (mongoose.mongo.BSON), so EJSON
// is available without adding `bson` as a direct dependency (it's already a
// transitive dep of mongoose) — repo convention is to avoid new dependencies
// when an existing one already carries what's needed.
const { EJSON } = mongoose.mongo.BSON;

// Minimal shape of what exportConnection needs from a Mongo `Db`, so tests can
// inject an in-memory fake instead of a real connection — same injectable-client
// pattern as ImapClientLike in src/lib/imap-replies.ts.
export interface CollectionLike {
  find(query: Record<string, unknown>): AsyncIterable<Record<string, unknown>>;
}
export interface DbLike {
  listCollections(): { toArray(): Promise<{ name: string }[]> };
  collection(name: string): CollectionLike;
}
// What a connected database handle looks like, for the orchestration layer.
export interface OpenDb {
  db: DbLike;
  close(): Promise<void>;
}

export interface DbExportResult {
  ok: boolean;
  reason?: string;
  collections: Record<string, number>; // collectionName -> document count exported
}

export interface BackupManifest {
  generatedAt: string;
  databases: Record<string, DbExportResult>;
}

// One EJSON document per line (relaxed:false — the "canonical" mode), so
// ObjectId/Date/etc. round-trip losslessly through restore. This is the
// serializer covered by the EJSON round-trip unit test.
export function serializeDoc(doc: Record<string, unknown>): string {
  return EJSON.stringify(doc, undefined, undefined, { relaxed: false });
}

export function deserializeDoc(line: string): Record<string, unknown> {
  return EJSON.parse(line) as Record<string, unknown>;
}

async function exportOneCollection(db: DbLike, name: string, outDir: string): Promise<number> {
  const filePath = path.join(outDir, `${name}.ndjson`);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  let count = 0;
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const doc of db.collection(name).find({})) {
      stream.write(`${serializeDoc(doc)}\n`);
      count += 1;
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }
  debug('exported %s: %d docs', name, count);
  return count;
}

// Exports EVERY collection of one already-connected database to
// <outDir>/<collection>.ndjson — one EJSON document per line. Collections are
// processed one at a time (never more than one collection's documents in
// memory at once, and never both DBs at once — the caller loops databases the
// same way), which is the "stream/iterate collection-by-collection" hard rule.
export async function exportConnection(db: DbLike, outDir: string): Promise<Record<string, number>> {
  fs.mkdirSync(outDir, { recursive: true });
  const counts: Record<string, number> = {};
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    // eslint-disable-next-line no-await-in-loop
    counts[name] = await exportOneCollection(db, name, outDir);
  }
  return counts;
}

// Real connector: opens an ad hoc Mongoose connection to `uri` dedicated to
// this export (never reuses/blocks the app's own long-lived connection), and
// exposes just the DbLike surface exportConnection needs. Overridable in tests
// so the orchestration below never touches a real Mongo.
export async function defaultConnect(uri: string): Promise<OpenDb> {
  const conn = mongoose.createConnection(uri);
  await conn.asPromise();
  if (!conn.db) throw new Error('connection opened with no db handle');
  const { db } = conn;
  return { db: db as unknown as DbLike, close: () => conn.close() };
}

async function exportLabeledDb(
  label: string,
  uri: string | undefined,
  outDir: string,
  connect: (uri: string) => Promise<OpenDb>,
): Promise<DbExportResult> {
  if (!uri) {
    const reason = `${label} skipped — no URI configured for this database`;
    debug(reason);
    return { ok: false, reason, collections: {} };
  }
  let opened: OpenDb | undefined;
  try {
    opened = await connect(uri);
    const collections = await exportConnection(opened.db, outDir);
    return { ok: true, collections };
  } catch (e) {
    const reason = (e as Error).message;
    debug('%s export failed: %s', label, reason);
    return { ok: false, reason, collections: {} };
  } finally {
    if (opened) await opened.close().catch(/* istanbul ignore next */() => undefined);
  }
}

export interface RunBackupOptions {
  // Defaults: MONGO_DB_URI (webjamsalem, this app's own DB) and
  // GIGS_MONGO_DB_URI — the WebJamSocketCluster URI ALREADY used by
  // src/model/gig/gig-schema.ts to read the `gigs` collection from that same
  // database, so no new Heroku config var is needed for the second DB.
  primaryUri?: string;
  secondaryUri?: string;
  connect?: (uri: string) => Promise<OpenDb>;
}

// Exports both prod databases (web-jam-tools#116) into outDir/<label>/*.ndjson
// plus a manifest.json summary. A DB whose URI isn't configured is skipped with
// a logged warning (reflected in the manifest as ok:false), not a thrown error —
// locally GIGS_MONGO_DB_URI is normally unset.
export async function runFullBackup(outDir: string, opts: RunBackupOptions = {}): Promise<BackupManifest> {
  const connect = opts.connect || defaultConnect;
  const primaryUri = opts.primaryUri ?? process.env.MONGO_DB_URI;
  const secondaryUri = opts.secondaryUri ?? process.env.GIGS_MONGO_DB_URI;

  const databases: Record<string, DbExportResult> = {};
  databases.webjamsalem = await exportLabeledDb('webjamsalem', primaryUri, path.join(outDir, 'webjamsalem'), connect);
  databases.webjamsocket = await exportLabeledDb('webjamsocket', secondaryUri, path.join(outDir, 'webjamsocket'), connect);

  const manifest: BackupManifest = { generatedAt: new Date().toISOString(), databases };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export default {
  serializeDoc, deserializeDoc, exportConnection, defaultConnect, runFullBackup,
};

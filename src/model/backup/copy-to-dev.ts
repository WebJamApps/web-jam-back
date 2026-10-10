import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import dropbox from '#src/lib/dropbox.js';
import facebookTokenModel from '../facebook/facebook-schema.js';
import {
  DATABASE,
  RestoreRefusal,
  accessTokenOf,
  checkChosenRun,
  downloadAndVerify,
  mongooseIndexRebuilder,
  registerDeclaredModels,
  replaceFromFolder,
  type IndexFailure,
  type MissingIndex,
  type RebuildIndexes,
  type RestoreCollectionLike,
  type RestoreDbLike,
  type RestoreDropboxLike,
  type RestoreTransform,
} from './backup-restore.js';
import { findRealAddresses, scrubDocument } from './email-scrub.js';
import { TOP_ADMIN_ROLE } from './top-admin-guard.js';

// Copies a chosen good run of production into the DEV database, with its personal data made
// safe on the way in (web-jam-tools#1083, web-jam-back#1146). Reads only the run's files from
// Dropbox; production itself is never touched.

type Doc = Record<string, unknown>;

const USERS = 'users';
const FACEBOOK_TOKENS = facebookTokenModel.collection.collectionName;
const PING_TIMEOUT_MS = 10_000;

export const DEV_SETTING = 'DEV_MONGO_DB_URI';
export const DEV_ASLEEP = 'the DEV database is asleep or cannot be reached; '
  + 'Resume for the DEV cluster on the Atlas website wakes it';

// The slice of a DEV connection a copy needs, so tests can inject an in-memory fake.
export interface DevCollectionLike extends RestoreCollectionLike {
  find(query: Doc): AsyncIterable<Doc>;
}
export interface DevDbLike extends RestoreDbLike {
  collection(name: string): DevCollectionLike;
  command(command: Doc): Promise<unknown>;
}
export interface DevConnection {
  db: DevDbLike;
  close(): Promise<void>;
  rebuildIndexes?: RebuildIndexes;
}
export type ConnectDev = (uri: string) => Promise<DevConnection>;

// ── The refusals that need nothing but the two settings ──────────────────────

function parseMongoUri(uri: string): { hosts: string[]; database: string } | null {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^/]*@)?([^/?@]+)(?:\/([^?]*))?/i.exec(uri.trim());
  if (!match) return null;
  const hosts = match[1].split(',').map((h) => h.replace(/:\d+$/, '').toLowerCase()).filter(Boolean);
  if (hosts.length === 0) return null;
  let database = '';
  try {
    database = decodeURIComponent(match[2] || '');
  } catch {
    return null;
  }
  return { hosts, database };
}

// Refuses, with nothing touched, unless the setting names a DEV database on a host that is not
// production's. A mistyped setting must not point the copy at production.
export function checkDevTarget(devUri: string | undefined, productionUri: string | undefined): void {
  if (!devUri || !devUri.trim()) throw new RestoreRefusal('setting', `${DEV_SETTING} is not set`);
  const dev = parseMongoUri(devUri);
  if (!dev) throw new RestoreRefusal('setting', `${DEV_SETTING} cannot be parsed`);
  if (!dev.database) throw new RestoreRefusal('database name', `the database name in ${DEV_SETTING} cannot be determined`);
  if (!dev.database.toLowerCase().includes('dev')) {
    throw new RestoreRefusal('database name', `the database name in ${DEV_SETTING} does not contain "dev"`);
  }
  const production = productionUri ? parseMongoUri(productionUri) : null;
  if (!production) throw new RestoreRefusal('host', "production's host cannot be determined");
  if (dev.hosts.some((host) => production.hosts.includes(host))) {
    throw new RestoreRefusal('host', `the host in ${DEV_SETTING} is production's host`);
  }
}

// ── Reaching DEV ─────────────────────────────────────────────────────────────

/* istanbul ignore next */
export const connectDev: ConnectDev = async (uri) => {
  const conn = mongoose.createConnection(uri, { serverSelectionTimeoutMS: PING_TIMEOUT_MS });
  await conn.asPromise();
  if (!conn.db) throw new Error('connection opened with no db handle');
  const modelRoot = path.resolve(import.meta.dirname, '..');
  const rebuild = mongooseIndexRebuilder(conn);
  return {
    db: conn.db as unknown as DevDbLike,
    close: () => conn.close(),
    rebuildIndexes: async (collections) => {
      await registerDeclaredModels(modelRoot);
      return rebuild(collections);
    },
  };
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function reachDev(connect: ConnectDev, uri: string, timeoutMs: number): Promise<DevConnection> {
  let conn: DevConnection | undefined;
  try {
    conn = await withTimeout(connect(uri), timeoutMs);
    await withTimeout(conn.db.command({ ping: 1 }), timeoutMs);
    return conn;
  } catch {
    // Unreachable and "cannot tell" (a timeout) are refused the same way.
    await conn?.close().catch(() => undefined);
    throw new RestoreRefusal('dev unreachable', DEV_ASLEEP);
  }
}

// ── What is changed on the way in ────────────────────────────────────────────

function transformFor(replacedBy: Map<string, number>): RestoreTransform {
  return (doc, collection) => {
    const keepEmail = collection === USERS && doc.userType === TOP_ADMIN_ROLE;
    const scrubbed = scrubDocument(doc, collection, { keepEmail });
    const out = scrubbed.doc;
    if (collection === FACEBOOK_TOKENS && 'value' in out) out.value = '';
    replacedBy.set(collection, (replacedBy.get(collection) || 0) + scrubbed.replaced);
    // An explicit redirect to its own collection: the scrubbed record is never mistaken for one.
    return { collection, doc: out };
  };
}

export interface ReadBackResult {
  status: 'none' | 'found' | 'failed';
  remaining: number | null;
  message: string;
}

// Reads every DEV collection back and counts real addresses other than the top-level admin
// accounts' own.
async function readBack(db: DevDbLike): Promise<ReadBackResult> {
  try {
    const found: string[] = [];
    const own = new Set<string>();
    const names = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
    for (const name of names) {
      // eslint-disable-next-line no-await-in-loop, no-restricted-syntax
      for await (const doc of db.collection(name).find({})) {
        found.push(...findRealAddresses(doc));
        if (name === USERS && doc.userType === TOP_ADMIN_ROLE && typeof doc.email === 'string') {
          own.add(doc.email.toLowerCase());
        }
      }
    }
    const remaining = found.filter((address) => !own.has(address)).length;
    return remaining === 0
      ? { status: 'none', remaining: 0, message: 'no real email address found in DEV' }
      : { status: 'found', remaining, message: `${remaining} real email address(es) remain in DEV` };
  } catch (e) {
    return { status: 'failed', remaining: null, message: `the read-back of DEV failed: ${(e as Error).message}` };
  }
}

// ── The copy ─────────────────────────────────────────────────────────────────

export interface CopiedCollection {
  collection: string;
  copied: number;
  manifest: number | null;
  addressesReplaced: number;
}

export interface CopyResult {
  collections: CopiedCollection[];
  missingIndexes: MissingIndex[];
  indexFailures: IndexFailure[];
  readBack: ReadBackResult;
  // True only when the read-back ran and found no real address.
  clean: boolean;
}

export interface CopyToDevOptions {
  runName: string;
  dropboxClient?: RestoreDropboxLike;
  devUri?: string;
  productionUri?: string;
  connect?: ConnectDev;
  scratchDir?: string;
  timeoutMs?: number;
  onProgress?: (step: string) => void;
}

let copyActive = false;

export function isCopyActive(): boolean {
  return copyActive;
}

export function resetCopyActive(): void {
  copyActive = false;
}

// Every refusal happens before DEV is changed.
export async function copyToDev(opts: CopyToDevOptions): Promise<CopyResult> {
  const client: RestoreDropboxLike = opts.dropboxClient || dropbox;
  const progress = opts.onProgress || (() => undefined);
  const devUri = opts.devUri ?? process.env[DEV_SETTING];
  if (copyActive) throw new RestoreRefusal('in progress', 'a copy to DEV is already running');
  copyActive = true;
  const scratch = opts.scratchDir || path.join(os.tmpdir(), `webjam-copy-to-dev-${opts.runName}`);
  let dev: DevConnection | undefined;
  try {
    progress('checking the DEV setting');
    checkDevTarget(devUri, opts.productionUri ?? process.env.MONGO_DB_URI);

    progress('checking that DEV is awake');
    dev = await reachDev(opts.connect || connectDev, devUri as string, opts.timeoutMs ?? PING_TIMEOUT_MS);

    progress('checking the chosen run');
    const token = await accessTokenOf(client);
    const manifest = await checkChosenRun(client, token, opts.runName);
    const counts = manifest.databases[DATABASE]?.collections;
    if (!counts) throw new RestoreRefusal('files', `${opts.runName} holds no ${DATABASE} collections`);

    progress('downloading and checking the run files');
    await downloadAndVerify(client, token, opts.runName, counts, scratch);

    const replacedBy = new Map<string, number>();
    const replaced = await replaceFromFolder({
      db: dev.db,
      folder: scratch,
      manifestCounts: counts,
      transform: transformFor(replacedBy),
      rebuildIndexes: dev.rebuildIndexes,
      onProgress: progress,
    });

    progress('reading DEV back');
    const check = await readBack(dev.db);
    return {
      collections: replaced.collections.map((c) => ({
        collection: c.collection,
        copied: c.restored,
        manifest: c.manifest,
        addressesReplaced: replacedBy.get(c.collection) || 0,
      })),
      missingIndexes: replaced.missingIndexes,
      indexFailures: replaced.indexFailures,
      readBack: check,
      clean: check.status === 'none',
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    await dev?.close().catch(() => undefined);
    copyActive = false;
  }
}

export default { copyToDev, checkDevTarget, isCopyActive, resetCopyActive };

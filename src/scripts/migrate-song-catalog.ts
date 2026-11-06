// Additive catalog backfill: keep every legacy field for the existing music page.
// Dry run by default. Run only on a disposable local copy; never on production.
// No composer/performer credit is promoted to a verified writer or rights claim.
import mongoose from 'mongoose';
import { config } from 'dotenv';
import { isMainModule } from '../lib/migration-cli.js';

type Doc = Record<string, unknown>;
export interface CatalogStore {
  find(filter: Doc): { toArray(): Promise<Doc[]> };
  updateOne(filter: Doc, update: Doc): Promise<unknown>;
  indexes(): Promise<Array<{ name?: string; key: Doc; unique?: boolean; sparse?: boolean }>>;
  createIndex(key: Doc, options: { name: string; unique: boolean; sparse: boolean }): Promise<string>;
  dropIndex(name: string): Promise<unknown>;
}

export function isLocalCopy(uri: string): boolean {
  try {
    const target = new URL(uri);
    return target.protocol === 'mongodb:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      && /(?:^|[-_])(copy|test|dev)(?:[-_]|$)/i.test(target.pathname.slice(1));
  } catch { return false; }
}

export function recordingBackfill(song: Doc): Doc[] {
  if (typeof song.url !== 'string' || !song.url) return [];
  return [Object.fromEntries(['url', 'artist', 'year'].filter((key) => song[key] !== undefined)
    .map((key) => [key, song[key]]).concat(typeof song.album === 'string' ? [['release', song.album]] : []))];
}

export async function migrateSongCatalog(store: CatalogStore, apply = false, log: (message: string) => void = console.log) {
  const indexes = await store.indexes();
  const urlIndexes = indexes.filter((index) => Object.keys(index.key).length === 1 && index.key.url === 1);
  const needsSparse = !urlIndexes.some((index) => index.unique && index.sparse);
  const oldIndexes = urlIndexes.filter((index) => index.unique && !index.sparse && index.name);
  if (needsSparse && apply) {
    // Build the replacement BEFORE removing the old constraint. A failed build
    // leaves the existing uniqueness protection intact.
    await store.createIndex({ url: 1 }, { name: 'song_url_sparse', unique: true, sparse: true });
  }
  if (apply) {
    for (const index of oldIndexes) {
      // eslint-disable-next-line no-await-in-loop
      await store.dropIndex(index.name!);
    }
  }
  const songs = await store.find({ recordings: { $exists: false } }).toArray();
  for (const song of songs) {
    if (apply) {
      // The absence predicate also protects an agent's concurrent catalog edits.
      // eslint-disable-next-line no-await-in-loop
      await store.updateOne({ _id: song._id, recordings: { $exists: false } }, { $set: { recordings: recordingBackfill(song) } });
    }
  }
  const indexChanges = (needsSparse ? 1 : 0) + oldIndexes.length;
  log(`${apply ? 'APPLY' : 'DRY RUN'}: ${songs.length} song(s), ${indexChanges} index change(s). Legacy fields and rights unchanged.`);
  return { songs: songs.length, indexChanges };
}

export async function run(argv = process.argv.slice(2), uri = process.env.MONGO_DB_URI || '') {
  if (argv.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported; default is dry-run.');
  if (!isLocalCopy(uri)) throw new Error('Refusing: use a local database named as a dev, test, or copy database.');
  try {
    await mongoose.connect(uri, { autoIndex: false });
    const collection = mongoose.connection.collection('songs');
    return await migrateSongCatalog(collection as unknown as CatalogStore, argv.includes('--apply'));
  } finally { await mongoose.disconnect(); }
}

/* istanbul ignore if -- CLI only; tests import the functions without connecting */
if (isMainModule(import.meta.url)) {
  config({ quiet: true });
  run().catch(() => {
    console.error('Song catalog migration failed; verify the local copy and database access.');
    process.exitCode = 1;
  });
}

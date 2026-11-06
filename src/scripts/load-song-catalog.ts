// src/scripts/load-song-catalog.ts — web-jam-back#1228
//
// Fills the grown song catalog in web-jam-back from:
// 1. BMI's registered works (49 works, verified writers and work numbers)
// 2. CD Baby's releases ("Solo Acoustic", "live from central Florida, 2001 - 2005", etc.)
// 3. Dropbox music archive (recordings, audio URLs, cover & mission songs)
// 4. Songs not yet recorded (unrecorded originals with sparse unique url)
//
// INVARIANT: Performers and writers go in separate fields; website artist credits
// are NEVER read as writers.
//
// Dry run by default. Pass --apply to write to the database. Idempotent.
// SAFETY: Refuses to run against non-local/production databases unless --force is passed.

import fs from 'node:fs';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import resetSongData from '../model/song/reset-song.js';
import { isMainModule } from '../lib/migration-cli.js';

type Doc = Record<string, unknown>;

export interface CatalogStore {
  find(filter: Doc): { toArray(): Promise<Doc[]> };
  findOne(filter: Doc): Promise<Doc | null>;
  updateOne(filter: Doc, update: Doc): Promise<unknown>;
  insertOne(doc: Doc): Promise<unknown>;
  countDocuments(filter: Doc): Promise<number>;
}

export interface SongWriter {
  name: string;
  share?: number;
}

export interface SongRecording {
  isrc?: string;
  release?: string;
  artist?: string;
  url?: string;
  year?: number;
}

export interface SongCatalogDoc {
  _id?: unknown;
  title: string;
  artist: string;
  composer?: string;
  category: 'original' | 'pub' | 'mission';
  album?: string;
  year?: number;
  url?: string;
  image?: string;
  orderBy?: number;
  writers: SongWriter[];
  bmiWorkNumber?: string;
  iswc?: string;
  copyrightRegistration?: string;
  recordings: SongRecording[];
}

export interface BmiWorkRecord {
  title: string;
  bmiWorkNumber: string;
  writers: SongWriter[];
}

export interface CdBabyRelease {
  release: string;
  artist: string;
  upc?: string;
  year?: number;
  tracks: Array<{
    title: string;
    isrc?: string;
    year?: number;
    artist?: string;
  }>;
}

export interface ArchiveSongRecord {
  title: string;
  artist: string;
  category: 'original' | 'pub' | 'mission';
  composer?: string;
  album?: string;
  year?: number;
  url?: string;
  image?: string;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function toDisplayTitle(title: string): string {
  const words = title.trim().split(/\s+/);
  const minorWords = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'in', 'of']);
  const formatted = words.map((w, index) => {
    const lower = w.toLowerCase();
    if (index > 0 && minorWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');

  return formatted
    .replace(/\bDon t\b/gi, "Don't")
    .replace(/\bI ll\b/gi, "I'll")
    .replace(/\bI m\b/gi, "I'm")
    .replace(/\bSam s\b/gi, "Sam's")
    .replace(/\bSomebody s\b/gi, "Somebody's")
    .replace(/\bYou re\b/gi, "You're")
    .replace(/\bWon t\b/gi, "Won't")
    .replace(/\bWorld s\b/gi, "World's")
    .replace(/\bMr Fate\b/gi, 'Mr. Fate');
}

function extractDefaultWriter(lines: string[]): string {
  for (const line of lines) {
    if (/writer account:\s*sherman\s+joshua\s+victor|sherman,\s*joshua\s*victor/i.test(line)) {
      return 'Joshua Victor Sherman';
    }
  }
  return 'Joshua Sherman';
}

function parseWorkRow(line: string, defaultWriter: string): BmiWorkRecord | null {
  const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const bmiWorkNumber = parts[1];
  if (!bmiWorkNumber || /BMI work number/i.test(bmiWorkNumber)) return null;
  return {
    title: toDisplayTitle(parts[0]),
    bmiWorkNumber,
    writers: [{ name: defaultWriter, share: 100 }],
  };
}

export function parseBmiWorksMarkdown(content: string): BmiWorkRecord[] {
  const lines = content.split('\n');
  const results: BmiWorkRecord[] = [];
  const defaultWriter = extractDefaultWriter(lines);

  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && /Title\s*\|\s*BMI work number/i.test(trimmed)) {
      inTable = true;
      continue;
    }
    if (inTable && trimmed.startsWith('|') && !trimmed.includes('---')) {
      const work = parseWorkRow(trimmed, defaultWriter);
      if (work) results.push(work);
    }
  }
  return results;
}

export function parseCdBabyData(input: string | CdBabyRelease[]): CdBabyRelease[] {
  return typeof input === 'string' ? JSON.parse(input) : input;
}

export function parseArchiveSongs(input: string | ArchiveSongRecord[]): ArchiveSongRecord[] {
  return typeof input === 'string' ? JSON.parse(input) : input;
}

export const BASELINE_CDBABY_RELEASES: CdBabyRelease[] = [
  {
    release: 'Solo Acoustic',
    artist: 'Josh Sherman',
    upc: '634479161407',
    year: 2001,
    tracks: [
      { title: 'Break Out' },
      { title: 'Drink a Beer' },
      { title: 'Drive' },
      { title: 'Elizabeth' },
      { title: 'Jane Doe' },
      { title: 'Why' },
    ],
  },
  {
    release: 'live from central Florida, 2001 - 2005',
    artist: 'Josh Sherman Band',
    upc: '634479151651',
    year: 2005,
    tracks: [
      { title: 'All My Life' },
      { title: 'Dog Eat Dog' },
      { title: 'Frustration' },
      { title: 'No More Worlds' },
      { title: "Somebody's Fool" },
      { title: 'What You Wanted' },
    ],
  },
];

export interface LoadSourcesOptions {
  bmiWorks?: BmiWorkRecord[];
  cdBabyReleases?: CdBabyRelease[];
  archiveSongs?: ArchiveSongRecord[];
}

function mergeCdBabyTrack(catalogMap: Map<string, SongCatalogDoc>, track: CdBabyRelease['tracks'][0], release: CdBabyRelease) {
  const key = normalizeTitle(track.title);
  const performer = track.artist || release.artist;
  const recording: SongRecording = {
    release: release.release,
    artist: performer,
    isrc: track.isrc,
    year: track.year || release.year,
  };

  const existing = catalogMap.get(key);
  if (existing) {
    const hasRecording = existing.recordings.some((r) => r.release === recording.release && r.artist === recording.artist);
    if (!hasRecording) existing.recordings.push(recording);
  } else {
    catalogMap.set(key, {
      title: track.title,
      artist: performer,
      category: 'original',
      writers: [],
      recordings: [recording],
    });
  }
}

function backfillExistingSong(existing: SongCatalogDoc, song: ArchiveSongRecord, recording?: SongRecording) {
  existing.category = song.category;
  existing.url ||= song.url;
  existing.album ||= song.album;
  existing.year ||= song.year;
  existing.image ||= song.image;
  existing.composer ||= song.composer;
  if (recording) {
    const hasRec = existing.recordings.some((r) => r.url === recording.url
      || (r.release === recording.release && r.artist === recording.artist));
    if (!hasRec) existing.recordings.push(recording);
  }
}

function mergeArchiveSong(catalogMap: Map<string, SongCatalogDoc>, song: ArchiveSongRecord) {
  const key = normalizeTitle(song.title);
  const existing = catalogMap.get(key);
  const recording: SongRecording | undefined = song.url ? {
    release: song.album,
    artist: song.artist,
    url: song.url,
    year: song.year,
  } : undefined;

  if (existing) {
    backfillExistingSong(existing, song, recording);
  } else {
    catalogMap.set(key, {
      title: song.title,
      artist: song.artist,
      composer: song.composer,
      category: song.category,
      album: song.album,
      year: song.year,
      url: song.url,
      image: song.image,
      writers: [],
      recordings: recording ? [recording] : [],
    });
  }
}

export function assembleCatalog(sources: LoadSourcesOptions): SongCatalogDoc[] {
  const catalogMap = new Map<string, SongCatalogDoc>();

  if (sources.bmiWorks) {
    for (const work of sources.bmiWorks) {
      catalogMap.set(normalizeTitle(work.title), {
        title: work.title,
        artist: 'Josh Sherman',
        category: 'original',
        writers: [...work.writers],
        bmiWorkNumber: work.bmiWorkNumber,
        recordings: [],
      });
    }
  }

  if (sources.cdBabyReleases) {
    for (const release of sources.cdBabyReleases) {
      for (const track of release.tracks) {
        mergeCdBabyTrack(catalogMap, track, release);
      }
    }
  }

  if (sources.archiveSongs) {
    for (const song of sources.archiveSongs) {
      mergeArchiveSong(catalogMap, song);
    }
  }

  return Array.from(catalogMap.values());
}

export function isSafeToRun(uri: string, force: boolean): boolean {
  if (!uri) return false;
  if (force) return true;
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test') || dbName.includes('copy');
  return isLocal || isDevOrTest;
}

export interface PlanOperation {
  type: 'INSERT' | 'UPDATE' | 'UNCHANGED';
  title: string;
  item: SongCatalogDoc;
  existingId?: unknown;
  changes?: Record<string, unknown>;
  description: string;
}

function findMatchingDoc(existingDocs: Doc[], item: SongCatalogDoc): Doc | undefined {
  const norm = normalizeTitle(item.title);
  return existingDocs.find((d) => normalizeTitle(String(d.title || '')) === norm
    || (typeof item.url === 'string' && Boolean(item.url) && d.url === item.url));
}

function mergeRecordingsList(existingRecs: SongRecording[], newRecs: SongRecording[]): SongRecording[] | null {
  const merged = [...existingRecs];
  let added = false;
  for (const rec of newRecs) {
    const exists = existingRecs.some((r) => (rec.url && r.url === rec.url)
      || (rec.release && r.release === rec.release && r.artist === rec.artist));
    if (!exists) {
      merged.push(rec);
      added = true;
    }
  }
  return added ? merged : null;
}

function checkWriterChanges(existing: Doc, item: SongCatalogDoc): SongWriter[] | null {
  if (item.writers.length > 0 && (!Array.isArray(existing.writers) || (existing.writers as Doc[]).length === 0)) {
    return item.writers;
  }
  return null;
}

function checkRecordingChanges(existing: Doc, item: SongCatalogDoc): SongRecording[] | null {
  if (item.recordings.length > 0) {
    const existingRecs = Array.isArray(existing.recordings) ? (existing.recordings as SongRecording[]) : [];
    return mergeRecordingsList(existingRecs, item.recordings);
  }
  return null;
}

function computeSongChanges(existing: Doc, item: SongCatalogDoc): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (item.bmiWorkNumber && existing.bmiWorkNumber !== item.bmiWorkNumber) {
    changes.bmiWorkNumber = item.bmiWorkNumber;
  }
  const writers = checkWriterChanges(existing, item);
  if (writers) changes.writers = writers;
  const recordings = checkRecordingChanges(existing, item);
  if (recordings) changes.recordings = recordings;
  if (item.url && !existing.url) changes.url = item.url;
  if (item.album && !existing.album) changes.album = item.album;
  if (item.year && !existing.year) changes.year = item.year;
  if (item.image && !existing.image) changes.image = item.image;
  return changes;
}

export async function planCatalogSync(store: CatalogStore, catalog: SongCatalogDoc[]): Promise<PlanOperation[]> {
  const existingDocs = await store.find({}).toArray();
  const operations: PlanOperation[] = [];

  for (const item of catalog) {
    const existing = findMatchingDoc(existingDocs, item);
    if (!existing) {
      operations.push({
        type: 'INSERT',
        title: item.title,
        item,
        description: `Insert new song "${item.title}" (${item.category}) | BMI: ${item.bmiWorkNumber || 'none'}`
          + ` | Writers: ${item.writers.length} | Recordings: ${item.recordings.length}`,
      });
      continue;
    }

    const changes = computeSongChanges(existing, item);
    if (Object.keys(changes).length > 0) {
      operations.push({
        type: 'UPDATE',
        title: item.title,
        item,
        existingId: existing._id,
        changes,
        description: `Update song "${item.title}" (${item.category}) | changes: ${Object.keys(changes).join(', ')}`,
      });
    } else {
      operations.push({
        type: 'UNCHANGED',
        title: item.title,
        item,
        existingId: existing._id,
        description: `Unchanged song "${item.title}" (${item.category}) | in sync`,
      });
    }
  }

  return operations;
}

export async function executeCatalogSync(
  store: CatalogStore,
  catalog: SongCatalogDoc[],
  apply = false,
  log: (msg: string) => void = console.log,
) {
  const operations = await planCatalogSync(store, catalog);
  const plannedInserts = operations.filter((op) => op.type === 'INSERT');
  const plannedUpdates = operations.filter((op) => op.type === 'UPDATE');
  const unchanged = operations.filter((op) => op.type === 'UNCHANGED');

  const mode = apply ? 'APPLY' : 'DRY RUN';
  log(`--- SONG CATALOG LOADER (${mode}) ---`);
  for (const op of operations) {
    log(`[${op.type}] ${op.description}`);
  }

  log(`\nREPORT: ${plannedInserts.length} to insert, ${plannedUpdates.length} to update, `
    + `${unchanged.length} unchanged. Total catalog: ${catalog.length} song(s).`);

  if (!apply) {
    return {
      inserted: 0,
      updated: 0,
      unchanged: unchanged.length,
      plannedInserts: plannedInserts.length,
      plannedUpdates: plannedUpdates.length,
      totalCatalog: catalog.length,
    };
  }

  let actualInserts = 0;
  let actualUpdates = 0;

  for (const op of plannedInserts) {
    const payload: Doc = { ...op.item };
    if (!payload.url) delete payload.url; // Sparse uniqueness for unrecorded songs
    // eslint-disable-next-line no-await-in-loop
    await store.insertOne(payload);
    actualInserts += 1;
  }

  for (const op of plannedUpdates) {
    // eslint-disable-next-line no-await-in-loop
    await store.updateOne({ _id: op.existingId }, { $set: op.changes! });
    actualUpdates += 1;
  }

  const finalTotal = await store.countDocuments({});
  log(`APPLY COMPLETE: ${actualInserts} inserted, ${actualUpdates} updated, `
    + `${unchanged.length} unchanged. Collection count: ${finalTotal}.`);

  return {
    inserted: actualInserts,
    updated: actualUpdates,
    unchanged: unchanged.length,
    plannedInserts: plannedInserts.length,
    plannedUpdates: plannedUpdates.length,
    totalCatalog: catalog.length,
    finalCollectionCount: finalTotal,
  };
}

export interface CliOptions {
  apply: boolean;
  force: boolean;
  bmiFile?: string;
  cdBabyFile?: string;
  archiveFile?: string;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
  };
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };
  const bmiFile = getArg('--bmi-file');
  if (bmiFile) opts.bmiFile = bmiFile;
  const cdBabyFile = getArg('--cdbaby-file');
  if (cdBabyFile) opts.cdBabyFile = cdBabyFile;
  const archiveFile = getArg('--archive-file');
  if (archiveFile) opts.archiveFile = archiveFile;
  return opts;
}

export function resolveSources(opts: CliOptions): LoadSourcesOptions {
  const defaultBmiPath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/bmi-works-2026-11-04.md';
  const bmiPath = opts.bmiFile || process.env.BMI_WORKS_FILE || defaultBmiPath;
  let bmiWorks: BmiWorkRecord[] | undefined;
  if (fs.existsSync(bmiPath)) {
    bmiWorks = parseBmiWorksMarkdown(fs.readFileSync(bmiPath, 'utf8'));
  }

  const defaultCdBabyPath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/cd-baby-releases.json';
  const cdBabyPath = opts.cdBabyFile || process.env.CDBABY_RELEASES_FILE || defaultCdBabyPath;
  let cdBabyReleases: CdBabyRelease[] | undefined;
  if (fs.existsSync(cdBabyPath)) {
    cdBabyReleases = parseCdBabyData(fs.readFileSync(cdBabyPath, 'utf8'));
  } else {
    cdBabyReleases = BASELINE_CDBABY_RELEASES;
  }

  const defaultArchivePath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/dropbox-music-archive.json';
  const archivePath = opts.archiveFile || process.env.SONG_ARCHIVE_FILE || defaultArchivePath;
  let archiveSongs: ArchiveSongRecord[] | undefined;
  if (fs.existsSync(archivePath)) {
    archiveSongs = parseArchiveSongs(fs.readFileSync(archivePath, 'utf8'));
  } else {
    archiveSongs = resetSongData.songs as ArchiveSongRecord[];
  }

  return { bmiWorks, cdBabyReleases, archiveSongs };
}

export async function run(argv = process.argv.slice(2), uri = process.env.MONGO_DB_URI || '') {
  const opts = parseCliArgs(argv);
  const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@'); // eslint-disable-line sonarjs/slow-regex

  if (!isSafeToRun(uri, opts.force)) {
    throw new Error(
      `Refusing: target database "${maskedUri}" is not a recognized local, DEV, or TEST database. `
      + 'Pass --force to run on a deliberate target.',
    );
  }

  const sources = resolveSources(opts);
  const catalog = assembleCatalog(sources);

  try {
    await mongoose.connect(uri, { autoIndex: false });
    const collection = mongoose.connection.collection('songs');
    return await executeCatalogSync(collection as unknown as CatalogStore, catalog, opts.apply);
  } finally {
    await mongoose.disconnect();
  }
}

/* istanbul ignore if -- CLI execution */
if (isMainModule(import.meta.url)) {
  config({ quiet: true });
  run().catch((err) => {
    console.error('Song catalog load failed:', (err as Error).message);
    process.exitCode = 1;
  });
}

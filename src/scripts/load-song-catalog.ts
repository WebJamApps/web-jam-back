// src/scripts/load-song-catalog.ts — web-jam-back#1228
//
// Fills the grown song catalog in web-jam-back from:
// 1. BMI's registered works (49 works, verified per-work writers and work numbers)
// 2. CD Baby's releases ("Solo Acoustic", "live from central Florida, 2001 - 2005", etc.)
// 3. Dropbox music archive (recordings, audio URLs, cover & mission songs)
// 4. Songs not yet recorded (unrecorded originals with sparse unique url)
//
// INVARIANTS:
// - Performers and writers go in separate fields; website artist credits
//   or release performer credits are NEVER read or converted into song writers.
// - Rights provenance: unknown writer/share details are preserved as unknown
//   instead of inferring sole ownership from account membership.
// - Source integrity: missing, empty, or unrecognized sources produce a clear refusal,
//   with zero writes; baseline seeds must not masquerade as captured sources.
// - Multi-source enrichment: matching recordings merge missing identifiers/URLs and
//   detect conflicting identifiers rather than silently discarding later sources.
// - Post-apply verification: post-apply counts and mutation results must strictly match
//   the planned report before declaring completion.
//
// Dry run by default. Pass --apply to write to the database. Idempotent.
// SAFETY: Refuses to run against non-local/production databases unless --force is passed.

import fs from 'node:fs';
import { config } from 'dotenv';
import mongoose from 'mongoose';
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

function extractInlineShare(raw: string): { name: string; share?: number } {
  const trimmed = raw.trim();
  if ((trimmed.endsWith(')') && trimmed.includes('(')) || (trimmed.endsWith(']') && trimmed.includes('['))) {
    const openChar = trimmed.endsWith(')') ? '(' : '[';
    const openIdx = trimmed.lastIndexOf(openChar);
    const candidateName = trimmed.slice(0, openIdx).trim();
    const shareStr = trimmed.slice(openIdx + 1, -1).replace('%', '').trim();
    const parsed = Number.parseFloat(shareStr);
    if (candidateName && !Number.isNaN(parsed)) {
      return { name: candidateName, share: parsed };
    }
  }

  let sep: string | null = null;
  if (trimmed.includes(' - ')) {
    sep = ' - ';
  } else if (trimmed.includes(': ')) {
    sep = ': ';
  }
  if (sep) {
    const idx = trimmed.lastIndexOf(sep);
    const candidateName = trimmed.slice(0, idx).trim();
    const shareStr = trimmed.slice(idx + sep.length).replace('%', '').trim();
    const parsed = Number.parseFloat(shareStr);
    if (candidateName && !Number.isNaN(parsed)) {
      return { name: candidateName, share: parsed };
    }
  }

  return { name: trimmed };
}

export function parseWriterCell(writerText: string, shareText?: string): SongWriter[] {
  if (!writerText || !writerText.trim()) return [];

  const parsedShares: (number | undefined)[] = [];
  if (shareText && shareText.trim()) {
    const rawShareItems = shareText.split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
    for (const item of rawShareItems) {
      const match = item.match(/(\d+(?:\.\d+)?)/);
      parsedShares.push(match ? Number.parseFloat(match[1]) : undefined);
    }
  }

  const delimiter = writerText.includes(';') ? ';' : ',';
  const rawWriters = writerText.split(delimiter).map((w) => w.trim()).filter(Boolean);

  const writers: SongWriter[] = [];
  rawWriters.forEach((rawWriter, idx) => {
    const { name, share: inlineShare } = extractInlineShare(rawWriter);
    const colShare = parsedShares[idx];
    const finalShare = inlineShare ?? colShare;

    if (name) {
      const writer: SongWriter = { name };
      if (typeof finalShare === 'number' && !Number.isNaN(finalShare)) {
        writer.share = finalShare;
      }
      writers.push(writer);
    }
  });

  return writers;
}

interface TableColumns {
  titleCol: number;
  workNumCol: number;
  writerCol: number;
  shareCol: number;
}

function findTableColumns(cells: string[]): TableColumns | null {
  const isHeader = cells.some((c) => /title/i.test(c))
    && cells.some((c) => /work\s*(?:number|#)?/i.test(c));
  if (!isHeader) return null;

  return {
    titleCol: cells.findIndex((c) => /title/i.test(c)),
    workNumCol: cells.findIndex((c) => /work\s*(?:number|#)?/i.test(c)),
    writerCol: cells.findIndex((c) => /writer/i.test(c)),
    shareCol: cells.findIndex((c) => /share/i.test(c)),
  };
}

function parseWorkTableRow(cells: string[], cols: TableColumns): BmiWorkRecord | null {
  if (cols.titleCol === -1 || cols.workNumCol === -1) return null;
  const titleRaw = cells[cols.titleCol];
  const workNumRaw = cells[cols.workNumCol];
  if (!titleRaw || !workNumRaw || /bmi\s*work\s*number/i.test(workNumRaw)) return null;

  const writerRaw = cols.writerCol !== -1 && cols.writerCol < cells.length ? cells[cols.writerCol] : undefined;
  const shareRaw = cols.shareCol !== -1 && cols.shareCol < cells.length ? cells[cols.shareCol] : undefined;
  const writers = writerRaw ? parseWriterCell(writerRaw, shareRaw) : [];

  return {
    title: toDisplayTitle(titleRaw),
    bmiWorkNumber: workNumRaw,
    writers,
  };
}

export function parseBmiWorksMarkdown(content: string): BmiWorkRecord[] {
  const lines = content.split('\n');
  const results: BmiWorkRecord[] = [];
  let cols: TableColumns | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      cols = null;
      continue;
    }
    const cells = trimmed.split('|').map((c) => c.trim());
    if (cells.length > 0 && cells[0] === '') cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();

    if (!cols) {
      cols = findTableColumns(cells);
      continue;
    }

    if (trimmed.includes('---')) continue;
    const work = parseWorkTableRow(cells, cols);
    if (work) results.push(work);
  }

  return results;
}

export function validateBmiWorks(works: BmiWorkRecord[], filePath: string): BmiWorkRecord[] {
  if (!Array.isArray(works) || works.length === 0) {
    throw new Error(`Refusing to run: BMI works source file "${filePath}" contains no recognized works.`);
  }
  for (const w of works) {
    if (!w.title || !w.bmiWorkNumber) {
      throw new Error(`Refusing to run: BMI works source file "${filePath}" contains invalid work records.`);
    }
  }
  return works;
}

export function validateCdBabyReleases(releases: unknown, filePath: string): CdBabyRelease[] {
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new Error(`Refusing to run: CD Baby releases source file "${filePath}" contains invalid or empty release records.`);
  }
  for (const rel of releases as Partial<CdBabyRelease>[]) {
    if (
      !rel.release
      || typeof rel.release !== 'string'
      || !rel.artist
      || typeof rel.artist !== 'string'
      || !Array.isArray(rel.tracks)
      || rel.tracks.length === 0
    ) {
      throw new Error(`Refusing to run: CD Baby releases source file "${filePath}" contains unrecognized release shape.`);
    }
    for (const track of rel.tracks) {
      if (!track.title || typeof track.title !== 'string') {
        throw new Error(`Refusing to run: CD Baby releases source file "${filePath}" contains track with missing title.`);
      }
    }
  }
  return releases as CdBabyRelease[];
}

export function validateArchiveSongs(songs: unknown, filePath: string): ArchiveSongRecord[] {
  if (!Array.isArray(songs) || songs.length === 0) {
    throw new Error(`Refusing to run: music archive source file "${filePath}" contains invalid or empty song records.`);
  }
  const validCategories = new Set(['original', 'pub', 'mission']);
  for (const song of songs as Partial<ArchiveSongRecord>[]) {
    if (
      !song.title
      || typeof song.title !== 'string'
      || !song.artist
      || typeof song.artist !== 'string'
      || !song.category
      || !validCategories.has(song.category)
    ) {
      throw new Error(`Refusing to run: music archive source file "${filePath}" contains unrecognized song shape.`);
    }
  }
  return songs as ArchiveSongRecord[];
}

export function parseCdBabyData(input: string | CdBabyRelease[]): CdBabyRelease[] {
  let parsed: unknown;
  try {
    parsed = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (err) {
    throw new Error(`Refusing to run: CD Baby releases source file is not valid JSON: ${(err as Error).message}`);
  }
  return validateCdBabyReleases(parsed, 'input');
}

export function parseArchiveSongs(input: string | ArchiveSongRecord[]): ArchiveSongRecord[] {
  let parsed: unknown;
  try {
    parsed = typeof input === 'string' ? JSON.parse(input) : input;
  } catch (err) {
    throw new Error(`Refusing to run: music archive source file is not valid JSON: ${(err as Error).message}`);
  }
  return validateArchiveSongs(parsed, 'input');
}

export function isRecordingMatch(r1: SongRecording, r2: SongRecording): boolean {
  if (r1.isrc && r2.isrc && r1.isrc.trim().toUpperCase() === r2.isrc.trim().toUpperCase()) {
    return true;
  }
  if (r1.url && r2.url && r1.url.trim() === r2.url.trim()) {
    return true;
  }
  const r1Rel = (r1.release || '').trim().toLowerCase();
  const r2Rel = (r2.release || '').trim().toLowerCase();
  const r1Art = (r1.artist || '').trim().toLowerCase();
  const r2Art = (r2.artist || '').trim().toLowerCase();
  if (r1Rel && r2Rel && r1Rel === r2Rel && r1Art && r2Art && r1Art === r2Art) {
    return true;
  }
  return false;
}

function enrichStringProp(
  target: SongRecording,
  incoming: SongRecording,
  prop: 'isrc' | 'url' | 'release' | 'artist',
): { modified: boolean; conflict?: string } {
  const incVal = incoming[prop]?.trim();
  if (!incVal) return { modified: false };
  const targetVal = target[prop]?.trim();
  if (!targetVal) {
    target[prop] = prop === 'isrc' ? incVal.toUpperCase() : incVal;
    return { modified: true };
  }
  const match = prop === 'url' ? targetVal === incVal : targetVal.toLowerCase() === incVal.toLowerCase();
  if (!match) {
    return {
      modified: false,
      conflict: `Conflicting ${prop.toUpperCase()} for recording: existing "${targetVal}" vs incoming "${incVal}"`,
    };
  }
  return { modified: false };
}

function enrichYearProp(target: SongRecording, incoming: SongRecording): { modified: boolean; conflict?: string } {
  if (typeof incoming.year !== 'number' || Number.isNaN(incoming.year)) return { modified: false };
  if (typeof target.year !== 'number' || Number.isNaN(target.year)) {
    target.year = incoming.year;
    return { modified: true };
  }
  if (target.year !== incoming.year) {
    return {
      modified: false,
      conflict: `Conflicting year for recording: existing ${target.year} vs incoming ${incoming.year}`,
    };
  }
  return { modified: false };
}

export function enrichRecording(
  target: SongRecording,
  incoming: SongRecording,
): { modified: boolean; conflict?: string } {
  let anyModified = false;
  const stringProps: ('isrc' | 'url' | 'release' | 'artist')[] = ['isrc', 'url', 'release', 'artist'];

  for (const prop of stringProps) {
    const res = enrichStringProp(target, incoming, prop);
    if (res.conflict) return res;
    if (res.modified) anyModified = true;
  }

  const yearRes = enrichYearProp(target, incoming);
  if (yearRes.conflict) return yearRes;
  if (yearRes.modified) anyModified = true;

  return { modified: anyModified };
}

export function mergeRecordingsList(
  existingRecs: SongRecording[],
  incomingRecs: SongRecording[],
  songTitle = '',
): SongRecording[] | null {
  const merged: SongRecording[] = existingRecs.map((r) => ({ ...r }));
  let changed = false;

  for (const incoming of incomingRecs) {
    const match = merged.find((r) => isRecordingMatch(r, incoming));
    if (match) {
      const { modified, conflict } = enrichRecording(match, incoming);
      if (conflict) {
        throw new Error(`Cannot merge recordings for song "${songTitle}": ${conflict}`);
      }
      if (modified) changed = true;
    } else {
      merged.push({ ...incoming });
      changed = true;
    }
  }

  return changed ? merged : null;
}

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
    const match = existing.recordings.find((r) => isRecordingMatch(r, recording));
    if (match) {
      const { conflict } = enrichRecording(match, recording);
      if (conflict) {
        throw new Error(`Cannot merge CD Baby recording for song "${existing.title}": ${conflict}`);
      }
    } else {
      existing.recordings.push(recording);
    }
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
  if (song.url) existing.url ||= song.url;
  if (song.album) existing.album ||= song.album;
  if (song.year) existing.year ||= song.year;
  if (song.image) existing.image ||= song.image;
  if (song.composer) existing.composer ||= song.composer;
  if (recording) {
    const match = existing.recordings.find((r) => isRecordingMatch(r, recording));
    if (match) {
      const { conflict } = enrichRecording(match, recording);
      if (conflict) {
        throw new Error(`Cannot merge archive recording for song "${existing.title}": ${conflict}`);
      }
    } else {
      existing.recordings.push(recording);
    }
  }
}

function mergeArchiveSong(catalogMap: Map<string, SongCatalogDoc>, song: ArchiveSongRecord) {
  const key = normalizeTitle(song.title);
  const existing = catalogMap.get(key);
  const recording: SongRecording | undefined = (song.url || song.album) ? {
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

export function parseMongoUri(uri: string): { hosts: string[]; dbName: string } | null {
  if (!uri || typeof uri !== 'string') return null;
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?([^/?#]+)(?:\/([^?#]*))?/i);
  if (!match) return null;
  const hostsPart = match[1];
  const rawDbName = match[2] || '';
  const dbName = decodeURIComponent(rawDbName.trim()).toLowerCase();
  const hosts = hostsPart.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (hosts.length === 0) return null;
  return { hosts, dbName };
}

export function isLocalHost(hostWithPort: string): boolean {
  const withoutPort = hostWithPort.replace(/:\d+$/, '').trim().toLowerCase();
  return withoutPort === 'localhost' || withoutPort === '127.0.0.1' || withoutPort === '::1' || withoutPort === '[::1]';
}

const DELIBERATE_SAFE_DB_REGEX = /(?:^|[-_.])(?:dev|test|copy)(?:[-_.]|$)/i;

export function isSafeToRun(uri: string, force: boolean): boolean {
  if (!uri || typeof uri !== 'string') return false;
  if (force) return true;

  const parsed = parseMongoUri(uri);
  if (!parsed) return false;

  const allHostsLocal = parsed.hosts.every((h) => isLocalHost(h));
  if (allHostsLocal) return true;

  if (!parsed.dbName) return false;
  return DELIBERATE_SAFE_DB_REGEX.test(parsed.dbName);
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

function checkWriterChanges(existing: Doc, item: SongCatalogDoc): SongWriter[] | null {
  if (item.writers.length > 0 && (!Array.isArray(existing.writers) || (existing.writers as Doc[]).length === 0)) {
    return item.writers;
  }
  return null;
}

function checkRecordingChanges(existing: Doc, item: SongCatalogDoc): SongRecording[] | null {
  if (item.recordings.length > 0) {
    const existingRecs = Array.isArray(existing.recordings) ? (existing.recordings as SongRecording[]) : [];
    return mergeRecordingsList(existingRecs, item.recordings, item.title);
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

async function applyMutations(
  store: CatalogStore,
  plannedInserts: PlanOperation[],
  plannedUpdates: PlanOperation[],
): Promise<{ actualInserts: number; actualUpdates: number }> {
  let actualInserts = 0;
  let actualUpdates = 0;

  for (const op of plannedInserts) {
    const payload: Doc = { ...op.item };
    if (!payload.url) delete payload.url; // Sparse uniqueness for unrecorded songs
    // eslint-disable-next-line no-await-in-loop
    const insertRes = await store.insertOne(payload) as { acknowledged?: boolean; insertedId?: unknown } | undefined;
    if (insertRes && insertRes.acknowledged === false) {
      throw new Error(`Failed to insert song "${op.title}": insert not acknowledged`);
    }
    actualInserts += 1;
  }

  for (const op of plannedUpdates) {
    // eslint-disable-next-line no-await-in-loop
    const updateRes = await store.updateOne({ _id: op.existingId }, { $set: op.changes! }) as {
      acknowledged?: boolean;
      matchedCount?: number;
      modifiedCount?: number;
    } | undefined;
    if (updateRes && (updateRes.acknowledged === false || updateRes.matchedCount === 0)) {
      throw new Error(
        `Failed to update song "${op.title}" (id: ${String(op.existingId)}): update matched 0 documents`,
      );
    }
    actualUpdates += 1;
  }

  return { actualInserts, actualUpdates };
}

function verifyApplyCounts(
  startCount: number,
  finalCount: number,
  plannedInserts: number,
  actualInserts: number,
  plannedUpdates: number,
  actualUpdates: number,
) {
  const expectedTotal = startCount + plannedInserts;
  if (actualInserts !== plannedInserts) {
    throw new Error(
      `Apply verification mismatch: expected ${plannedInserts} inserts, but completed ${actualInserts}`,
    );
  }
  if (actualUpdates !== plannedUpdates) {
    throw new Error(
      `Apply verification mismatch: expected ${plannedUpdates} updates, but completed ${actualUpdates}`,
    );
  }
  if (finalCount !== expectedTotal) {
    throw new Error(
      `Apply verification mismatch: starting count was ${startCount}, planned ${plannedInserts} inserts, `
      + `expected final count ${expectedTotal}, but collection count is ${finalCount}`,
    );
  }
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

  const startCount = await store.countDocuments({});
  const { actualInserts, actualUpdates } = await applyMutations(store, plannedInserts, plannedUpdates);
  const finalTotal = await store.countDocuments({});

  verifyApplyCounts(startCount, finalTotal, plannedInserts.length, actualInserts, plannedUpdates.length, actualUpdates);

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

function readRequiredSourceFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Refusing to run: missing required ${label} source file "${filePath}".`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    throw new Error(`Refusing to run: ${label} source file "${filePath}" is empty.`);
  }
  return content;
}

export function resolveSources(opts: CliOptions): LoadSourcesOptions {
  const defaultBmiPath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/bmi-works-2026-11-04.md';
  const bmiPath = opts.bmiFile || process.env.BMI_WORKS_FILE || defaultBmiPath;
  const bmiContent = readRequiredSourceFile(bmiPath, 'BMI works');
  const bmiWorks = validateBmiWorks(parseBmiWorksMarkdown(bmiContent), bmiPath);

  const defaultCdBabyPath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/cd-baby-releases.json';
  const cdBabyPath = opts.cdBabyFile || process.env.CDBABY_RELEASES_FILE || defaultCdBabyPath;
  const cdBabyContent = readRequiredSourceFile(cdBabyPath, 'CD Baby releases');
  const cdBabyReleases = parseCdBabyData(cdBabyContent);

  const defaultArchivePath = '/home/joshua/Dropbox/web-jam-llms/songwriting/account-look-up/dropbox-music-archive.json';
  const archivePath = opts.archiveFile || process.env.SONG_ARCHIVE_FILE || defaultArchivePath;
  const archiveContent = readRequiredSourceFile(archivePath, 'music archive');
  const archiveSongs = parseArchiveSongs(archiveContent);

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

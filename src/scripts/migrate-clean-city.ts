// src/scripts/migrate-clean-city.ts — web-jam-back#980 (city-targeting
// scope addition, 2026-07-18 comment)
//
// One-time cleanup so the AdminVenues city-targeting multi-select (JaMmusic
// #1238) is trustworthy: `city` is free text today, so "Salem" / "Salem, VA"
// / "SALEM" all show up as separate, un-mergeable options. This migration:
//   1. Splits an embedded state off `city` — "Salem, VA" -> city:"Salem" +
//      usState:"VA" (only when usState is currently empty; when usState is
//      already set and AGREES with the embedded code, the redundant ", VA"
//      is still stripped from city; when it DISAGREES, the venue is reported
//      ambiguous and left untouched — never silently overwritten).
//   2. Normalizes casing variants of the SAME city name (post state-split)
//      to a single canonical form: groups venues by lowercased city, and
//      when exactly one distinct variant in a group is properly title-cased
//      (e.g. "Salem" among "Salem"/"SALEM"/"salem"), that one wins and every
//      other variant in the group is rewritten to match it.
// Going forward, `city` holds the city name ONLY — state lives in `usState`.
//
// REPORT, DON'T GUESS (explicit in the issue): anything this script can't
// confidently resolve is printed in an "AMBIGUOUS — needs manual review"
// section and left completely untouched (no city/usState write for that
// venue). Two kinds of ambiguity:
//   - a `city` containing a comma that ISN'T a clean "City, ST" (2-letter
//     code) pattern, or whose embedded code conflicts with an existing
//     usState — can't confidently split.
//   - a casing group (same name, different case) with either NO clearly
//     title-cased variant, or MORE THAN ONE disagreeing title-cased variant
//     (e.g. "DeKalb" vs "Dekalb") — can't confidently pick a canonical form.
//
// LESSON FROM #954 (do not repeat — see migrate-drop-contact-verified.ts's
// header for the full story): writes go through the RAW MongoDB collection
// (Model.collection.updateOne per venue — city/usState stay in the schema so
// this isn't strictly the $unset failure mode, but every #980 migration uses
// the raw collection consistently per the issue's instruction).
//
// Idempotent: re-running after a prior --apply only touches venues whose
// (already-canonical) city would still change — which, once every value in a
// casing group has been rewritten to the same canonical string, is none.
// Read-only DRY RUN by default — prints exactly what it would change (and
// every ambiguous case); pass --apply to write the confident changes.
//
// SAFETY GUARD (mirrors the sibling #980/#974/#954 migrations): refuses to
// run at all against anything that doesn't look like local/DEV/TEST (db name
// containing 'dev'/'test', or localhost/127.0.0.1) unless --force is passed.
// Running it for real against prod is a deliberate act, run manually
// post-merge with Josh's explicit go (e.g. `heroku run "npm run
// migrate:clean-city -- --force" -a webjamsalem` for the dry run, then
// `--force --apply` to write) — never wired into build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:clean-city                    # dry run, DEV/local
//   npm run migrate:clean-city -- --apply          # writes, DEV/local only
//   npm run migrate:clean-city -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';

config(); // load .env if present

interface VenueDoc { _id: unknown; name?: string; city?: string; usState?: string }

// ── Embedded-state split ────────────────────────────────────────────────────
export type SplitResult =
  | { kind: 'no-change' }
  | { kind: 'split'; city: string; state: string }
  | { kind: 'ambiguous'; reason: string };

// A comma followed by exactly a 2-letter code (optionally trailed by a
// stray period, e.g. "D.C." style typos don't match — deliberately: that's
// reported ambiguous, not guessed). Anchored at the END of the string so
// "Winston-Salem, NC" splits on the LAST comma-code pair only.
const EMBEDDED_STATE_RE = /^(.*),\s*([A-Za-z]{2})\.?$/;

export function splitEmbeddedState(rawCity: string, existingUsState: string | undefined): SplitResult {
  const trimmed = rawCity.trim();
  if (!trimmed.includes(',')) return { kind: 'no-change' };
  const m = trimmed.match(EMBEDDED_STATE_RE);
  if (!m) return { kind: 'ambiguous', reason: `contains a comma but isn't a clear "City, ST" pattern: "${trimmed}"` };
  const cityPart = m[1].trim();
  const statePart = m[2].toUpperCase();
  if (!cityPart) return { kind: 'ambiguous', reason: `embedded state with no city text: "${trimmed}"` };
  const existing = (existingUsState || '').trim().toUpperCase();
  if (existing && existing !== statePart) {
    return { kind: 'ambiguous', reason: `embedded state "${statePart}" conflicts with existing usState "${existing}": "${trimmed}"` };
  }
  return { kind: 'split', city: cityPart, state: statePart };
}

// ── Casing canonicalization ─────────────────────────────────────────────────
// A word is "properly cased" when it starts with an uppercase letter — loose
// on purpose, so a real embedded-capital city name (McKinney, DeKalb,
// O'Fallon) still counts as ONE valid candidate casing. Split on whitespace
// AND hyphens (kept as separate tokens) so "Winston-Salem" and "St. Louis"
// both check word-by-word. The whole-string isAllOneCase check in
// isTitleCased below (not here) is what rules out "SALEM" / "salem"; two
// DIFFERENT mixed-case spellings of the same city (e.g. "DeKalb" vs
// "Dekalb") both pass this per-word check, so resolveCanonicalCasing's
// group-level comparison is what catches THAT disagreement and reports it
// ambiguous instead of guessing.
const WORD_SPLIT_RE = /([\s-])/;
function isProperWord(word: string): boolean {
  if (word === '') return true;
  return /^[A-Z]/.test(word);
}
export function isTitleCased(value: string): boolean {
  if (value !== value.trim() || !value) return false;
  const isAllOneCase = value === value.toUpperCase() || value === value.toLowerCase();
  if (isAllOneCase && value.replace(/[^A-Za-z]/g, '').length > 1) return false; // "SALEM" / "salem" — not properly cased
  return value.split(WORD_SPLIT_RE).every((token) => (WORD_SPLIT_RE.test(token) ? true : isProperWord(token)));
}

export interface AmbiguousCasingGroup { key: string; variants: string[] }
export interface CasingResult {
  canonicalMap: Map<string, string>;
  ambiguousGroups: AmbiguousCasingGroup[];
}

// Groups the given (already state-split, trimmed) city strings by lowercased
// key; within each multi-variant group, picks the single title-cased variant
// as canonical (see module header for the ambiguous cases).
export function resolveCanonicalCasing(cities: string[]): CasingResult {
  const groups = new Map<string, Set<string>>();
  for (const c of cities) {
    const key = c.toLowerCase();
    if (!groups.has(key)) groups.set(key, new Set());
    (groups.get(key) as Set<string>).add(c);
  }
  const canonicalMap = new Map<string, string>();
  const ambiguousGroups: AmbiguousCasingGroup[] = [];
  for (const [key, variantSet] of groups) {
    const variants = Array.from(variantSet);
    if (variants.length === 1) { canonicalMap.set(variants[0], variants[0]); continue; }
    const titleCasedVariants = variants.filter(isTitleCased);
    if (titleCasedVariants.length === 1) {
      const canonical = titleCasedVariants[0];
      for (const v of variants) canonicalMap.set(v, canonical);
    } else {
      ambiguousGroups.push({ key, variants: variants.sort() });
    }
  }
  return { canonicalMap, ambiguousGroups };
}

interface Plan {
  venue: VenueDoc;
  finalCity: string;
  finalUsState?: string;
}
interface AmbiguousVenue { venue: VenueDoc; reason: string }

// Build the per-venue split plan + collect split-level ambiguities. Split
// out of run() to keep its cognitive complexity down.
export function buildSplitPlans(venues: VenueDoc[]): { working: { venue: VenueDoc; city: string; state?: string }[]; ambiguous: AmbiguousVenue[] } {
  const working: { venue: VenueDoc; city: string; state?: string }[] = [];
  const ambiguous: AmbiguousVenue[] = [];
  for (const venue of venues) {
    const result = splitEmbeddedState(venue.city || '', venue.usState);
    if (result.kind === 'ambiguous') { ambiguous.push({ venue, reason: result.reason }); continue; }
    if (result.kind === 'split') { working.push({ venue, city: result.city, state: result.state }); continue; }
    working.push({ venue, city: (venue.city || '').trim() });
  }
  return { working, ambiguous };
}

// Apply the casing pass on top of the split plans, splitting out casing-level
// ambiguities and building the final per-venue write plan (only venues whose
// final city/usState actually differs from the stored value are included).
export function buildFinalPlans(
  working: { venue: VenueDoc; city: string; state?: string }[],
): { plans: Plan[]; ambiguous: AmbiguousVenue[] } {
  const { canonicalMap, ambiguousGroups } = resolveCanonicalCasing(working.map((w) => w.city));
  const ambiguousKeys = new Set(ambiguousGroups.map((g) => g.key));
  const plans: Plan[] = [];
  const ambiguous: AmbiguousVenue[] = [];
  for (const w of working) {
    if (ambiguousKeys.has(w.city.toLowerCase())) {
      const group = ambiguousGroups.find((g) => g.key === w.city.toLowerCase()) as AmbiguousCasingGroup;
      ambiguous.push({ venue: w.venue, reason: `casing variants disagree, no single title-cased form: ${group.variants.join(' / ')}` });
      continue;
    }
    const finalCity = canonicalMap.get(w.city) || w.city;
    const cityChanged = finalCity !== (w.venue.city || '').trim();
    const stateChanged = Boolean(w.state) && !(w.venue.usState || '').trim();
    if (!cityChanged && !stateChanged) continue; // no-op — nothing to write
    plans.push({
      venue: w.venue,
      finalCity,
      finalUsState: stateChanged ? w.state : undefined,
    });
  }
  return { plans, ambiguous };
}

// Print the plan/write line for every venue that would change, then the
// ambiguous-cases section (if any). Split out of run() to keep its cognitive
// complexity down.
function logPlansAndAmbiguous(plans: Plan[], ambiguous: AmbiguousVenue[], apply: boolean): void {
  for (const { venue, finalCity, finalUsState } of plans) {
    const verb = apply ? 'WRITE' : 'PLAN';
    const stateNote = finalUsState ? `, usState -> "${finalUsState}"` : '';
    console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" city "${venue.city}" -> "${finalCity}"${stateNote}`);
  }
  if (!ambiguous.length) return;
  console.log('\nAMBIGUOUS — needs manual review (left untouched):');
  for (const { venue, reason } of ambiguous) {
    console.log(`  venue ${String(venue._id)} "${venue.name}": ${reason}`);
  }
}

// Write every confirmed (non-ambiguous) plan via the raw collection. Split
// out of run() to keep its cognitive complexity down.
async function applyPlans(plans: Plan[]): Promise<number> {
  let modifiedCount = 0;
  for (const { venue, finalCity, finalUsState } of plans) {
    const update: Record<string, unknown> = { $set: { city: finalCity, ...(finalUsState ? { usState: finalUsState } : {}) } };
    const filter = { _id: new mongoose.Types.ObjectId(String(venue._id)) };
    // eslint-disable-next-line no-await-in-loop
    const res = await venueModel.Schema.collection.updateOne(filter, update);
    modifiedCount += res.modifiedCount || 0;
  }
  return modifiedCount;
}

async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('migrate-clean-city', 'migrate:clean-city');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  const venues = (await venueModel.find({ city: { $exists: true, $ne: '' } })) as unknown as VenueDoc[];
  const { working, ambiguous: splitAmbiguous } = buildSplitPlans(venues);
  const { plans, ambiguous: casingAmbiguous } = buildFinalPlans(working);
  const ambiguous = [...splitAmbiguous, ...casingAmbiguous];

  logPlansAndAmbiguous(plans, ambiguous, apply);

  const modifiedCount = apply ? await applyPlans(plans) : 0;

  console.log(`\n${venues.length} venue(s) scanned; ${plans.length} would change; ${ambiguous.length} ambiguous (needs Josh).`);
  console.log(apply
    ? `${modifiedCount} venue(s) updated.`
    : `Dry run — ${plans.length} venue(s) WOULD be updated. Re-run with --apply to write for real.`);

  await mongoose.connection.close();
}

// Only auto-execute when run directly — NOT when imported by a unit test.
/* istanbul ignore if -- exercised only when the script is executed directly, never under vitest */
if (isMainModule(import.meta.url)) {
  run().catch((err) => {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  });
}

export { run };

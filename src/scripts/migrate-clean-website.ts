// src/scripts/migrate-clean-website.ts — web-jam-back#1008
//
// Some venue records store `website` without a URL scheme — e.g.
// "www.petedyerivercourse.com" instead of "https://www.petedyerivercourse.com".
// Anything that renders the raw value as an href gets a RELATIVE URL (Josh
// hit this in production on the public gigs table:
// https://web-jam.com/www.petedyerivercourse.com). This migration finds
// venue records whose `website` is non-empty and has no URL scheme, and
// rewrites each to the same value prefixed with "https://".
//
// REPORT, DON'T GUESS (explicit in the issue): a `website` value is only
// rewritten when it confidently looks like a bare domain/URL missing its
// scheme. Everything else is either left untouched silently (already has a
// scheme, or empty/absent — nothing to do) or surfaced in its own report
// section so Josh can decide by hand:
//   - protocol-relative values ("//example.com") — reported, never rewritten
//     (upgrading these to "https://example.com" would be a guess about
//     intent this issue doesn't authorize).
//   - non-URL junk (a bare venue name, an email address, free text someone
//     typed into the field) — reported as "skipped, needs a human".
//
// NON-GOALS (see the issue): does not touch gig records (JaMmusic#1268 owns
// gig-side render-time normalization); does not upgrade an existing
// "http://" value to "https://"; does not add validation to the venue write
// path (POST/PATCH /venue) — this is a one-time data cleanup only.
//
// LESSON FROM #954 (see migrate-drop-contact-verified.ts's header for the
// full story): writes go through the RAW MongoDB collection
// (Model.collection.updateOne per venue), matching the sibling #980
// migrations' convention.
//
// Idempotent: once a value has been rewritten to carry a scheme, it's
// classified "already-schemed" on the next run and excluded — re-running
// after a successful --apply reports zero changes.
//
// SAFETY GUARD (mirrors the sibling #980/#974/#954 migrations): refuses to
// run at all against anything that doesn't look like local/DEV/TEST (db name
// containing 'dev'/'test', or localhost/127.0.0.1) unless --force is passed.
// Running it for real against prod is a deliberate act, run manually by Josh
// after reviewing the dry-run output posted to #1008 (e.g. `heroku run "npm
// run migrate:clean-website -- --force" -a webjamsalem` for the dry run,
// then `--force --apply` to write) — never wired into
// build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:clean-website                    # dry run, DEV/local
//   npm run migrate:clean-website -- --apply          # writes, DEV/local only
//   npm run migrate:clean-website -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';

config(); // load .env if present

interface VenueDoc { _id: unknown; name?: string; website?: string }

// ── Classification ──────────────────────────────────────────────────────
export type WebsiteCategory =
  | { kind: 'empty' }
  | { kind: 'already-schemed' }
  | { kind: 'protocol-relative' }
  | { kind: 'rewrite'; newValue: string }
  | { kind: 'junk'; reason: string };

// Any recognized "scheme://" prefix (http/https/ftp/etc.) — leave alone.
// Deliberately generic rather than http(s)-only: the issue only calls out
// NOT upgrading http->https, and treating any already-schemed value as
// "don't touch" is the safer, more general reading of that rule.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

// A confident bare-domain match: one or more dot-separated labels (so a
// dot-less bare word like a venue name or "TBD" never matches), optional
// port, optional path/query/fragment. No whitespace and no "@" anywhere —
// which also excludes an email address ("booking@example.com") from ever
// matching, since '@' isn't in the character class.
// eslint-disable-next-line sonarjs/slow-regex
const DOMAIN_LIKE_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:\d+)?([/?#].*)?$/i;

export function classifyWebsite(raw: string | undefined): WebsiteCategory {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { kind: 'empty' };
  if (SCHEME_RE.test(trimmed)) return { kind: 'already-schemed' };
  if (trimmed.startsWith('//')) return { kind: 'protocol-relative' };
  if (DOMAIN_LIKE_RE.test(trimmed)) return { kind: 'rewrite', newValue: `https://${trimmed}` };
  return { kind: 'junk', reason: `does not look like a URL: "${trimmed}"` };
}

export interface RewritePlan { venue: VenueDoc; newValue: string }
export interface ReportedVenue { venue: VenueDoc; reason: string }
export interface BuildPlansResult {
  plans: RewritePlan[];
  protocolRelative: ReportedVenue[];
  junk: ReportedVenue[];
}

// Classify every candidate venue into a rewrite plan or one of the two
// report-only buckets. 'empty' and 'already-schemed' venues are dropped
// silently (nothing to do, nothing to report). Split out of run() to keep
// its cognitive complexity down and to be independently unit-testable.
export function buildPlans(venues: VenueDoc[]): BuildPlansResult {
  const plans: RewritePlan[] = [];
  const protocolRelative: ReportedVenue[] = [];
  const junk: ReportedVenue[] = [];
  for (const venue of venues) {
    const category = classifyWebsite(venue.website);
    if (category.kind === 'rewrite') {
      plans.push({ venue, newValue: category.newValue });
    } else if (category.kind === 'protocol-relative') {
      protocolRelative.push({ venue, reason: `protocol-relative value, left as-is: "${(venue.website || '').trim()}"` });
    } else if (category.kind === 'junk') {
      junk.push({ venue, reason: category.reason });
    }
  }
  return { plans, protocolRelative, junk };
}

// Print the plan/write line for every venue that would change, then the two
// report-only sections (if non-empty). Split out of run() to keep its
// cognitive complexity down.
function logPlansAndReports(result: BuildPlansResult, apply: boolean): void {
  const { plans, protocolRelative, junk } = result;
  for (const { venue, newValue } of plans) {
    const verb = apply ? 'WRITE' : 'PLAN';
    console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" website "${venue.website}" -> "${newValue}"`);
  }
  if (protocolRelative.length) {
    console.log('\nPROTOCOL-RELATIVE — reported, not rewritten (needs a human decision):');
    for (const { venue, reason } of protocolRelative) {
      console.log(`  venue ${String(venue._id)} "${venue.name}": ${reason}`);
    }
  }
  if (junk.length) {
    console.log('\nSKIPPED, NEEDS A HUMAN — not a recognizable URL:');
    for (const { venue, reason } of junk) {
      console.log(`  venue ${String(venue._id)} "${venue.name}": ${reason}`);
    }
  }
}

// Write every rewrite plan via the raw collection. Split out of run() to
// keep its cognitive complexity down.
async function applyPlans(plans: RewritePlan[]): Promise<number> {
  let modifiedCount = 0;
  for (const { venue, newValue } of plans) {
    const filter = { _id: new mongoose.Types.ObjectId(String(venue._id)) };
    const update = { $set: { website: newValue } };
    // eslint-disable-next-line no-await-in-loop
    const res = await venueModel.Schema.collection.updateOne(filter, update);
    modifiedCount += res.modifiedCount || 0;
  }
  return modifiedCount;
}

async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('migrate-clean-website', 'migrate:clean-website');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  const venues = (await venueModel.find({ website: { $exists: true, $ne: '' } })) as unknown as VenueDoc[];
  const result = buildPlans(venues);
  const { plans, protocolRelative, junk } = result;

  logPlansAndReports(result, apply);

  const modifiedCount = apply ? await applyPlans(plans) : 0;

  console.log(`\n${venues.length} venue(s) scanned; ${plans.length} would change; `
    + `${protocolRelative.length} protocol-relative (reported); ${junk.length} junk (reported, needs Josh).`);
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

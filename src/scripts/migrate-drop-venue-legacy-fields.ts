// src/scripts/migrate-drop-venue-legacy-fields.ts — web-jam-back#1059
//
// One-time backfill for the venue-record/Prospect-Score redesign
// (~/Dropbox/web-jam-llms/gig-outreach/book-gig-skill-design-2026-08-16.md,
// sections 9 & 11, decisions D-18 through D-23, D-28, D-32 through D-35).
// `$unset`s the six retired fields from every existing venue document:
//   - payTier          -> replaced by payAmount
//   - originalsFit     -> replaced by audienceAttention
//   - travelBand       -> replaced by real distance (derived, paired issue)
//   - interested       -> replaced by personalFavorite
//   - relationshipStage -> dropped; returning/cold is now derived from gig history
//   - priority         -> dropped; the manual boost is retired outright
//
// This is purely a cleanup of the six removed fields — it does NOT populate
// any of the new fields (payAmount/audienceAttention/personalFavorite carry
// their schema defaults on next write; familyNearby is populated by the
// paired distance-derivation issue).
//
// Idempotent: only venues where at least one of the six fields still exists
// are candidates, so a re-run after a prior --apply is a no-op. Read-only DRY
// RUN by default — prints exactly what it would change; pass --apply to write.
//
// SAFETY GUARD (mirrors migrate-drop-in-scope.ts / migrate-gig-venue-id.ts):
// this migration permanently removes data from real venue records, so it
// refuses to run at all against anything that doesn't look like local/DEV/TEST
// (db name containing 'dev'/'test', or localhost/127.0.0.1) unless --force is
// passed. Running it for real against prod is a deliberate act, run manually
// post-merge with Josh's explicit go (e.g. `heroku run "npm run
// migrate:drop-venue-legacy-fields -- --force" -a webjamsalem` for the dry
// run, then `--force --apply` to write) — never wired into
// build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:drop-venue-legacy-fields                    # dry run against DEV/local
//   npm run migrate:drop-venue-legacy-fields -- --apply          # writes, DEV/local only
//   npm run migrate:drop-venue-legacy-fields -- --force --apply  # writes for real (prod)

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';

config(); // load .env if present

const LEGACY_FIELDS = ['payTier', 'originalsFit', 'travelBand', 'interested', 'relationshipStage', 'priority'] as const;

interface Args { apply: boolean; force: boolean }
export function parseArgs(argv: string[]): Args {
  return { apply: argv.includes('--apply'), force: argv.includes('--force') };
}

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────
// Mirrors migrate-drop-in-scope.ts's guard exactly: only db names/hosts that
// look local/DEV/TEST are allowed without --force. Pure predicate (no
// process.exit) so it's unit-testable; run() below is what actually exits.
export function isSafeToRun(uri: string, force: boolean): boolean {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
  return isLocal || isDevOrTest || force;
}

interface VenueDoc {
  _id: unknown;
  name?: string;
  payTier?: unknown;
  originalsFit?: unknown;
  travelBand?: unknown;
  interested?: unknown;
  relationshipStage?: unknown;
  priority?: unknown;
}

function logSafetyBlock(uri: string, maskedUri: string): void {
  console.error('ERROR: migrate-drop-venue-legacy-fields only runs against a local, DEV, or TEST database by default — never release/production.');
  console.error(`Target MONGO URI: ${maskedUri}`);
  console.error(`Parsed database name: ${(uri.split('?')[0].split('/').pop() || '').toLowerCase() || '(none)'}`);
  console.error('Pass --force to run against a different database anyway (a deliberate, reviewed prod backfill).');
}

// Which of the six legacy fields are actually present on this venue doc.
function presentLegacyFields(venue: VenueDoc): string[] {
  return LEGACY_FIELDS.filter((f) => venue[f] !== undefined);
}

async function run(): Promise<void> {
  const { apply, force } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_DB_URI || '';
  const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@'); // eslint-disable-line sonarjs/slow-regex
  if (!isSafeToRun(uri, force)) {
    logSafetyBlock(uri, maskedUri);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  // Idempotent: only venues that still carry at least one of the six fields
  // are candidates. Deliberately NOT scoped to status != archived — an
  // archived venue may be unarchived later and should not come back carrying
  // stale legacy data (mirrors migrate-drop-in-scope.ts's reasoning).
  const candidates = (await venueModel.find({
    $or: LEGACY_FIELDS.map((f) => ({ [f]: { $exists: true } })),
  })) as unknown as VenueDoc[];

  let applied = 0;
  for (const venue of candidates) {
    const fields = presentLegacyFields(venue);
    const unset: Record<string, ''> = {};
    for (const f of fields) unset[f] = '';
    const verb = apply ? 'WRITE' : 'PLAN';
    console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" -> unset [${fields.join(', ')}]`);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await venueModel.findByIdAndUpdate(String(venue._id), { $unset: unset });
      applied += 1;
    }
  }

  console.log(`\n${candidates.length} venue(s) scanned (carried at least one of ${LEGACY_FIELDS.join('/')}).`);
  console.log(apply
    ? `${applied} venue(s) updated.`
    : `Dry run — ${candidates.length} venue(s) WOULD be updated. Re-run with --apply to write for real.`);

  await mongoose.connection.close();
}

// Only auto-execute when run directly — NOT when imported by a unit test.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
/* istanbul ignore if -- exercised only when the script is executed directly, never under vitest */
if (isMain) {
  run().catch((err) => {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  });
}

export { run };

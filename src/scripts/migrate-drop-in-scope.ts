// src/scripts/migrate-drop-in-scope.ts — web-jam-back#954
//
// One-time backfill for dropping the `inScope` venue field entirely (it read
// as a duplicate of `outreachEligible` — Josh only ever used Eligible, #954).
// For every venue that still has an `inScope` field:
//   - `inScope: false` (the ballpark/farmer's-market crowd, e.g. Salem Red
//     Sox, ODAC Tournament) -> `doNotContact: true` (PERMANENT exclusion from
//     /outreach/candidates, #923) AND the `inScope` field is removed. The
//     venue stays visible/active — this is NOT an archive.
//   - `inScope: true` (or missing) -> just has the `inScope` field removed;
//     `doNotContact` is left untouched.
//
// Archived venues ARE included in this sweep (deliberately, unlike
// migrate-gig-venue-id.ts's venue query, which excludes archived venues for a
// DIFFERENT reason — avoiding ambiguous gig-name matches). An archived venue
// may be unarchived later, and if it was `inScope: false` it should come back
// permanently excluded via `doNotContact`, not silently back in scope.
//
// Idempotent: only venues where `inScope` still exists are candidates, so a
// re-run after a prior --apply is a no-op (the field is gone). Read-only DRY
// RUN by default — prints exactly what it would change; pass --apply to write.
//
// SAFETY GUARD (mirrors migrate-gig-venue-id.ts): this migration permanently
// flips doNotContact on real venue records, so it refuses to run at all
// against anything that doesn't look like local/DEV/TEST (db name containing
// 'dev'/'test', or localhost/127.0.0.1) unless --force is passed. Running it
// for real against prod is a deliberate act, run manually post-merge with
// Josh's explicit go (e.g. `heroku run "npm run migrate:drop-in-scope --
// --force" -a webjamsalem` for the dry run, then `--force --apply` to write)
// — never wired into build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:drop-in-scope                    # dry run against DEV/local
//   npm run migrate:drop-in-scope -- --apply          # writes, DEV/local only
//   npm run migrate:drop-in-scope -- --force --apply  # writes for real (prod)

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';

config(); // load .env if present

interface Args { apply: boolean; force: boolean }
export function parseArgs(argv: string[]): Args {
  return { apply: argv.includes('--apply'), force: argv.includes('--force') };
}

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────
// Mirrors migrate-gig-venue-id.ts's guard exactly: only db names/hosts that
// look local/DEV/TEST are allowed without --force. Pure predicate (no
// process.exit) so it's unit-testable; run() below is what actually exits.
export function isSafeToRun(uri: string, force: boolean): boolean {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
  return isLocal || isDevOrTest || force;
}

interface VenueDoc { _id: unknown; name?: string; inScope?: boolean }

function logSafetyBlock(uri: string, maskedUri: string): void {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  console.error('ERROR: migrate-drop-in-scope only runs against a local, DEV, or TEST database by default — never release/production.');
  console.error(`Target MONGO URI: ${maskedUri}`);
  console.error(`Parsed database name: ${dbName || '(none)'}`);
  console.error('Pass --force to run against a different database anyway (a deliberate, reviewed prod backfill).');
}

// Build the Mongo update for one venue + a human-readable plan/write label.
// `inScope: false` permanently flips doNotContact (and the field is always
// unset); `inScope: true` (or missing) just loses the field.
function buildVenueUpdate(venue: VenueDoc, apply: boolean): { update: Record<string, unknown>; label: string; wasOutOfScope: boolean } {
  const wasOutOfScope = venue.inScope === false;
  const verb = apply ? 'WRITE' : 'PLAN';
  if (wasOutOfScope) {
    return {
      update: { $unset: { inScope: '' }, $set: { doNotContact: true } },
      label: `${verb}: venue ${String(venue._id)} "${venue.name}" inScope:false -> doNotContact:true (inScope removed)`,
      wasOutOfScope: true,
    };
  }
  return {
    update: { $unset: { inScope: '' } },
    label: `${verb}: venue ${String(venue._id)} "${venue.name}" inScope removed (no other change)`,
    wasOutOfScope: false,
  };
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

  // Idempotent: only venues that still carry the field are candidates. Deliberately
  // NOT scoped to status != archived — an archived venue may be unarchived later
  // and should come back permanently excluded (doNotContact), not silently
  // back in scope (#954).
  const candidates = (await venueModel.find({
    inScope: { $exists: true },
  })) as unknown as VenueDoc[];

  let flippedToDoNotContact = 0;
  let applied = 0;
  for (const venue of candidates) {
    const { update, label, wasOutOfScope } = buildVenueUpdate(venue, apply);
    if (wasOutOfScope) flippedToDoNotContact += 1;
    console.log(`  ${label}`);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await venueModel.findByIdAndUpdate(String(venue._id), update);
      applied += 1;
    }
  }
  const fieldOnlyRemoved = candidates.length - flippedToDoNotContact;

  console.log(`\n${candidates.length} venue(s) scanned (still had inScope); `
    + `${flippedToDoNotContact} were inScope:false (-> doNotContact:true); ${fieldOnlyRemoved} just lose the field.`);
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

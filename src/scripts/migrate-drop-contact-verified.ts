// src/scripts/migrate-drop-contact-verified.ts — web-jam-back#974
//
// One-time backfill: drop the `contactVerified` venue field entirely. A
// valid, present primary `email` IS the verification now (see the #974
// sendability guard in outreach-controller.ts) — there's no separate manual
// flag to track. Unlike migrate-drop-in-scope.ts (#954), there's no
// side-effect field to flip here: every venue that still carries
// `contactVerified` simply has the field removed, nothing else changes.
//
// LESSON FROM #954 (do not repeat): a schema-bound mongoose update method
// ($unset via Model.findByIdAndUpdate / Model.updateMany) silently DROPS an
// unknown-field write instruction once that field has been removed from the
// schema (strict mode casts it away before the write ever reaches Mongo) — so
// the #954 migration's $unset appeared to run but did nothing in prod. This
// migration writes via the RAW MongoDB collection (Model.collection.
// updateMany(...)) instead, which bypasses mongoose's schema casting
// entirely, so the $unset actually lands.
//
// Idempotent: only venues where `contactVerified` still exists are
// candidates, so a re-run after a prior --apply is a no-op (the field is
// gone). Read-only DRY RUN by default — prints exactly what it would change;
// pass --apply to write.
//
// SAFETY GUARD (mirrors migrate-drop-in-scope.ts / migrate-gig-venue-id.ts):
// this migration writes across every venue record that still has the field,
// so it refuses to run at all against anything that doesn't look like
// local/DEV/TEST (db name containing 'dev'/'test', or localhost/127.0.0.1)
// unless --force is passed. Running it for real against prod is a deliberate
// act, run manually post-merge with Josh's explicit go (e.g. `heroku run
// "npm run migrate:drop-contact-verified -- --force" -a webjamsalem` for the
// dry run, then `--force --apply` to write) — never wired into
// build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:drop-contact-verified                    # dry run, DEV/local
//   npm run migrate:drop-contact-verified -- --apply          # writes, DEV/local only
//   npm run migrate:drop-contact-verified -- --force --apply  # writes for real (prod)

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
// Mirrors migrate-drop-in-scope.ts's guard exactly: only db names/hosts that
// look local/DEV/TEST are allowed without --force. Pure predicate (no
// process.exit) so it's unit-testable; run() below is what actually exits.
export function isSafeToRun(uri: string, force: boolean): boolean {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
  return isLocal || isDevOrTest || force;
}

interface VenueDoc { _id: unknown; name?: string }

const CONTACT_VERIFIED_FILTER = { contactVerified: { $exists: true } };

function logSafetyBlock(uri: string, maskedUri: string): void {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  console.error('ERROR: migrate-drop-contact-verified only runs against a local, DEV, or TEST database by default — never release/production.');
  console.error(`Target MONGO URI: ${maskedUri}`);
  console.error(`Parsed database name: ${dbName || '(none)'}`);
  console.error('Pass --force to run against a different database anyway (a deliberate, reviewed prod backfill).');
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

  // Idempotent: only venues that still carry the field are candidates.
  // Deliberately NOT scoped to status != archived — an archived venue may be
  // unarchived later and shouldn't come back with a stray legacy field.
  const candidates = (await venueModel.find(CONTACT_VERIFIED_FILTER)) as unknown as VenueDoc[];

  for (const venue of candidates) {
    console.log(`  ${apply ? 'WRITE' : 'PLAN'}: venue ${String(venue._id)} "${venue.name}" contactVerified removed`);
  }

  let modifiedCount = 0;
  if (apply && candidates.length) {
    // RAW COLLECTION WRITE — see the #954 lesson in the header comment above.
    // A schema-bound mongoose update ($unset via findByIdAndUpdate/updateMany)
    // would silently no-op here now that contactVerified is gone from the
    // schema; venueModel.Schema.collection is the native MongoDB driver
    // collection, which bypasses that casting entirely.
    const res = await venueModel.Schema.collection.updateMany(CONTACT_VERIFIED_FILTER, { $unset: { contactVerified: '' } });
    modifiedCount = res.modifiedCount || 0;
  }

  console.log(`\n${candidates.length} venue(s) scanned (still had contactVerified).`);
  console.log(apply
    ? `${modifiedCount} venue(s) updated.`
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

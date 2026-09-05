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
// LESSON FROM #954 (do not repeat — this migration mirrors
// migrate-drop-do-not-contact.ts, the POST-lesson script; NOT
// migrate-drop-in-scope.ts, which predates it): a schema-bound mongoose
// update method ($unset via Model.findByIdAndUpdate / Model.updateMany)
// silently DROPS an unknown-field write instruction once that field is
// removed from the schema — strict mode casts it away before the write ever
// reaches Mongo, so the run reports success while changing nothing. All six
// fields here are removed from venue-schema.ts in the same change, so EVERY
// $unset would be cast away. The write therefore goes through the RAW
// MongoDB collection (Model.collection.updateMany), which bypasses mongoose's
// schema casting entirely. The READ side needs no such treatment: Facade.find
// uses .lean(), so raw driver documents come back with the legacy fields
// intact and candidate detection works.
//
// Idempotent: only venues where at least one of the six fields still exists
// are candidates, so a re-run after a prior --apply is a no-op. Read-only DRY
// RUN by default — prints exactly what it would change; pass --apply to write.
//
// SAFETY GUARD (shared, src/lib/migration-cli.ts): this migration permanently
// removes data from real venue records, so it refuses to run at all against
// anything that doesn't look like local/DEV/TEST (db name containing
// 'dev'/'test', or localhost/127.0.0.1) unless --force is passed. Running it
// for real against prod is a deliberate act, run manually post-merge with
// Josh's explicit go (e.g. `heroku run "npm run
// migrate:drop-venue-legacy-fields -- --force" -a webjamsalem` for the dry
// run, then `--force --apply` to write) — never wired into
// build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:drop-venue-legacy-fields                    # dry run against DEV/local
//   npm run migrate:drop-venue-legacy-fields -- --apply          # writes, DEV/local only
//   npm run migrate:drop-venue-legacy-fields -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';

config(); // load .env if present

const LEGACY_FIELDS = ['payTier', 'originalsFit', 'travelBand', 'interested', 'relationshipStage', 'priority'] as const;

// Idempotent candidate filter: a venue is in scope only while it still
// carries at least one of the six. Used for BOTH the read (reporting) and
// the raw write, so the write cannot drift from what was planned.
const LEGACY_FILTER = { $or: LEGACY_FIELDS.map((f) => ({ [f]: { $exists: true } })) };

// $unset every legacy field in one write — $unset of an absent path is a
// no-op, so a venue carrying only some of the six is unaffected by the rest.
const LEGACY_UNSET = Object.fromEntries(LEGACY_FIELDS.map((f) => [f, ''])) as Record<string, ''>;

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

// Which of the six legacy fields are actually present on this venue doc.
function presentLegacyFields(venue: VenueDoc): string[] {
  return LEGACY_FIELDS.filter((f) => venue[f] !== undefined);
}

async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('migrate-drop-venue-legacy-fields', 'migrate:drop-venue-legacy-fields');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  // Deliberately NOT scoped to status != archived — an archived venue may be
  // unarchived later and should not come back carrying stale legacy data
  // (mirrors migrate-drop-in-scope.ts's reasoning).
  const candidates = (await venueModel.find(LEGACY_FILTER)) as unknown as VenueDoc[];

  for (const venue of candidates) {
    const fields = presentLegacyFields(venue);
    const verb = apply ? 'WRITE' : 'PLAN';
    console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" -> unset [${fields.join(', ')}]`);
  }

  let modifiedCount = 0;
  if (apply && candidates.length) {
    // RAW COLLECTION WRITE — see the #954 lesson in the header comment above.
    // One updateMany over the same candidate filter, so the field removal
    // actually reaches Mongo instead of being cast away by strict mode.
    const res = await venueModel.Schema.collection.updateMany(LEGACY_FILTER, { $unset: LEGACY_UNSET });
    modifiedCount = res.modifiedCount || 0;
  }

  console.log(`\n${candidates.length} venue(s) scanned (carried at least one of ${LEGACY_FIELDS.join('/')}).`);
  console.log(apply
    ? `${modifiedCount} venue(s) updated.`
    : `Dry run — ${candidates.length} venue(s) WOULD be updated. Re-run with --apply to write for real.`);

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

// src/scripts/migrate-drop-do-not-contact.ts — web-jam-back#980
//
// One-time backfill: `doNotContact` is deleted entirely (folded into
// `outreachEligible`, now the SOLE permanent stop/go gate). For every venue
// that still has `doNotContact: true`:
//   - set `outreachEligible: false` (the permanent exclusion moves here)
//   - APPEND a dated line to `notes` recording the prior exclusion (never
//     overwrite existing notes — same append rule as the live not-interested
//     outcome handler in outreach-controller.ts)
//   - `$unset doNotContact`
// A venue that has `doNotContact` set to anything OTHER than `true` (e.g.
// `false`, stored by a stray earlier write) just has the field removed —
// there is no prior exclusion to carry forward.
//
// LESSON FROM #954 (do not repeat — see migrate-drop-contact-verified.ts's
// header for the full story): a schema-bound mongoose update method ($unset
// via Model.findByIdAndUpdate / Model.updateMany) silently DROPS an
// unknown-field write instruction once that field is removed from the
// schema (strict mode casts it away before the write ever reaches Mongo).
// This migration writes via the RAW MongoDB collection
// (Model.collection.updateMany with an aggregation-pipeline update) instead,
// which bypasses mongoose's schema casting entirely, AND lets the notes
// append reference each document's OWN existing `notes` value in one atomic
// per-document write (no separate read-then-write race).
//
// Idempotent: only venues where `doNotContact` still exists are candidates,
// so a re-run after a prior --apply is a no-op (the field is gone). Read-only
// DRY RUN by default — prints exactly what it would change; pass --apply to
// write.
//
// SAFETY GUARD (mirrors migrate-drop-in-scope.ts / migrate-drop-contact-
// verified.ts): this migration permanently flips outreachEligible on real
// venue records, so it refuses to run at all against anything that doesn't
// look like local/DEV/TEST (db name containing 'dev'/'test', or
// localhost/127.0.0.1) unless --force is passed. Running it for real against
// prod is a deliberate act, run manually post-merge with Josh's explicit go
// (e.g. `heroku run "npm run migrate:drop-do-not-contact -- --force" -a
// webjamsalem` for the dry run, then `--force --apply` to write) — never
// wired into build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:drop-do-not-contact                    # dry run, DEV/local
//   npm run migrate:drop-do-not-contact -- --apply          # writes, DEV/local only
//   npm run migrate:drop-do-not-contact -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';

config(); // load .env if present

interface VenueDoc { _id: unknown; name?: string; doNotContact?: boolean; notes?: string }

const DNC_FILTER = { doNotContact: { $exists: true } };

// The dated note line appended for every venue that was doNotContact:true.
// Built once per run (same date for the whole batch, which is fine — it's a
// single migration run producing one dated record per venue).
export function buildNoteLine(now: Date): string {
  const dateStr = now.toISOString().slice(0, 10);
  return `[${dateStr}] Previously doNotContact:true (permanent exclusion) — migrated to outreachEligible:false (#980).`;
}

async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('migrate-drop-do-not-contact', 'migrate:drop-do-not-contact');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  // Idempotent: only venues that still carry the field are candidates.
  // Deliberately NOT scoped to status != archived — an archived venue may be
  // unarchived later and should come back permanently excluded
  // (outreachEligible:false), not silently back in play.
  const candidates = (await venueModel.find(DNC_FILTER)) as unknown as VenueDoc[];
  const wasDoNotContactTrue = candidates.filter((v) => v.doNotContact === true);
  const fieldOnlyRemoved = candidates.length - wasDoNotContactTrue.length;
  const now = new Date();
  const noteLine = buildNoteLine(now);

  for (const venue of candidates) {
    const verb = apply ? 'WRITE' : 'PLAN';
    if (venue.doNotContact === true) {
      console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" doNotContact:true -> outreachEligible:false `
        + `(note appended, doNotContact removed)`);
    } else {
      console.log(`  ${verb}: venue ${String(venue._id)} "${venue.name}" doNotContact removed (was not true — no other change)`);
    }
  }

  let modifiedCount = 0;
  if (apply && candidates.length) {
    // RAW COLLECTION WRITE — see the #954 lesson in the header comment above.
    // Two separate pipeline updateMany calls (one per prior-value branch) so
    // the "was true" group gets the outreachEligible flip + note append, and
    // the "was something else" group just loses the field — a single
    // pipeline can't conditionally add the note ONLY for a subset the same
    // way two scoped calls can, and keeps each call's intent simple to read.
    if (wasDoNotContactTrue.length) {
      const res = await venueModel.Schema.collection.updateMany(
        { doNotContact: true },
        [
          {
            $set: {
              outreachEligible: false,
              notes: {
                $cond: [
                  { $and: [{ $ne: ['$notes', null] }, { $ne: ['$notes', ''] }] },
                  { $concat: ['$notes', '\n', noteLine] },
                  noteLine,
                ],
              },
            },
          },
          { $unset: 'doNotContact' },
        ],
      );
      modifiedCount += res.modifiedCount || 0;
    }
    if (fieldOnlyRemoved) {
      const res = await venueModel.Schema.collection.updateMany(
        { doNotContact: { $exists: true, $ne: true } },
        { $unset: { doNotContact: '' } },
      );
      modifiedCount += res.modifiedCount || 0;
    }
  }

  console.log(`\n${candidates.length} venue(s) scanned (still had doNotContact); `
    + `${wasDoNotContactTrue.length} were doNotContact:true (-> outreachEligible:false + note); ${fieldOnlyRemoved} just lose the field.`);
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

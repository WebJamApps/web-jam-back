// src/scripts/backfill-family-nearby.ts — web-jam-back#1060
//
// One-time backfill of `familyNearby` for all existing venue records
// (~/Dropbox/web-jam-llms/gig-outreach/book-gig-skill-design-2026-08-16.md,
// sections 9 & 11, decision D-36).
//
// Computes `familyNearby` from the stored `address`, `city`, `usState`, and `zipCode`
// using `isFamilyNearby` (true if within 20 miles of Salem, Roanoke, Martinsville,
// Lynchburg, Gastonia, Rock Hill, or Harrisonburg; false otherwise).
//
// Idempotent: re-running after a prior --apply only touches venues whose stored
// `familyNearby` is unset or differs from the derived boolean.
// Read-only DRY RUN by default — prints candidate changes; pass --apply to write.
//
// SAFETY GUARD (shared, src/lib/migration-cli.ts): refuses to run at all against
// anything that doesn't look like local/DEV/TEST (db name containing 'dev'/'test',
// or localhost/127.0.0.1) unless --force is passed. Running it for real against
// prod is a deliberate act, run manually post-merge with Josh's explicit go:
//   heroku run "npm run migrate:backfill-family-nearby -- --force" -a webjamsalem
//   heroku run "npm run migrate:backfill-family-nearby -- --force --apply" -a webjamsalem
//
// Usage:
//   npm run migrate:backfill-family-nearby                    # dry run, DEV/local
//   npm run migrate:backfill-family-nearby -- --apply          # writes, DEV/local only
//   npm run migrate:backfill-family-nearby -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';
import { isFamilyNearby, resolveCoordinates } from '#src/lib/geo-distance.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';

config();

export interface VenueBackfillDoc {
  _id: unknown;
  name?: string;
  address?: string;
  city?: string;
  usState?: string;
  zipCode?: string;
  familyNearby?: boolean;
}

export interface FamilyNearbyPlan {
  venueId: string;
  venueName: string;
  currentValue: boolean | undefined;
  newValue: boolean;
  needsWrite: boolean;
  coordinatesResolved: boolean;
}

export function buildFamilyNearbyPlans(docs: VenueBackfillDoc[]): FamilyNearbyPlan[] {
  return docs.map((doc) => {
    const coords = resolveCoordinates(doc);
    const coordinatesResolved = coords !== null;
    const newValue = isFamilyNearby(doc);
    const currentValue = typeof doc.familyNearby === 'boolean' ? doc.familyNearby : undefined;
    const needsWrite = currentValue !== newValue;
    return {
      venueId: String(doc._id),
      venueName: doc.name || 'Unnamed Venue',
      currentValue,
      newValue,
      needsWrite,
      coordinatesResolved,
    };
  });
}

export async function executeBackfillWrites(plans: FamilyNearbyPlan[]): Promise<number> {
  let count = 0;
  for (const item of plans) {
    if (!item.needsWrite) continue;
    const docId = new mongoose.Types.ObjectId(item.venueId);
    // eslint-disable-next-line no-await-in-loop
    const res = await venueModel.Schema.collection.updateOne(
      { _id: docId },
      { $set: { familyNearby: item.newValue } },
    );
    count += res.modifiedCount || 0;
  }
  return count;
}

export async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('backfill-family-nearby', 'migrate:backfill-family-nearby');

  await mongoose.connect(uri);
  console.log(`Database connected: "${mongoose.connection.name}" at ${maskedUri}`);
  console.log(`Execution mode: ${apply ? 'APPLY (live writes)' : 'DRY RUN (no changes written)'}`);

  const allVenues = (await venueModel.find({})) as unknown as VenueBackfillDoc[];
  const plans = buildFamilyNearbyPlans(allVenues);
  const pending = plans.filter((p) => p.needsWrite);
  const unresolved = plans.filter((p) => !p.coordinatesResolved);

  for (const item of unresolved) {
    console.warn(
      `  WARN: venue ${item.venueId} "${item.venueName}" coordinates could not be resolved from address/city/state/zipCode; `
      + 'defaulting familyNearby to false',
    );
  }

  for (const plan of pending) {
    const actionLabel = apply ? 'WRITE' : 'PLAN';
    const priorState = plan.currentValue === undefined ? 'unset' : String(plan.currentValue);
    const unresolvedNote = plan.coordinatesResolved ? '' : ' [UNRESOLVED COORDINATES]';
    console.log(`  ${actionLabel}: venue ${plan.venueId} "${plan.venueName}" [${priorState} -> ${plan.newValue}]${unresolvedNote}`);
  }

  const modified = apply ? await executeBackfillWrites(plans) : 0;

  console.log('\nFamily proximity backfill summary:');
  console.log(`  Total venues inspected: ${allVenues.length}`);
  console.log(`  Venues requiring update: ${pending.length}`);
  console.log(`  Venues with unresolved coordinates: ${unresolved.length}`);
  console.log(`  Venues modified in DB: ${modified}`);

  await mongoose.connection.close();
}

/* istanbul ignore if -- exercised only when the script is executed directly, never under vitest */
if (isMainModule(import.meta.url)) {
  run().catch((err: unknown) => {
    console.error('backfill-family-nearby encountered an error:', (err as Error).message);
    process.exit(1);
  });
}

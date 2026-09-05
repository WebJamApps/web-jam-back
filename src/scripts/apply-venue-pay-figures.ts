// src/scripts/apply-venue-pay-figures.ts — web-jam-back#1061
//
// One-time backfill to apply approved pay figures to nine specific venues.
// For eight venues, sets payAmount to the approved amount.
// For Botetourt Farmers Market, sets payAmount to 0 and appends a note
// (without overwriting existing notes) recording the agreed amount and
// payment status.
//
// This is a one-time script — not wired into any build, migration runner,
// or CI step. Run it manually post-merge with Josh's explicit go.
//
// Usage:
//   npm run apply-venue-pay-figures

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import venueModel from '#src/model/venue/venue-facade.js';

config(); // load .env if present

interface VenueFigure {
  name: string;
  payAmount: number;
  noteToAdd?: string;
}

// The nine approved venue pay figures
const VENUE_FIGURES: VenueFigure[] = [
  { name: 'The Beast of Blacksburg', payAmount: 50 },
  { name: 'Radford Farmers Market', payAmount: 100 },
  { name: 'Pete Dye River Course', payAmount: 150 },
  { name: 'Tequilas Sports Bar and Grill', payAmount: 200 },
  { name: 'Stave & Cork', payAmount: 150 },
  { name: 'Botetourt Farmers Market', payAmount: 0, noteToAdd: 'Agreed 50 for the 6 June 2026 market; never paid.' },
  { name: 'Salem Farmers Market', payAmount: 50 },
  { name: 'Harrisonburg Farmers Market', payAmount: 30 },
  { name: 'Hungry Mother State Park', payAmount: 150 },
];

interface VenueDoc {
  _id: unknown;
  name?: string;
  payAmount?: number;
  notes?: string;
}

async function run(): Promise<void> {
  const uri = process.env.MONGO_DB_URI || '';
  const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@'); // eslint-disable-line sonarjs/slow-regex

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);

  let found = 0;
  let notFound = 0;

  for (const figure of VENUE_FIGURES) {
    // eslint-disable-next-line no-await-in-loop
    const venue = (await venueModel.findOne({ name: figure.name })) as unknown as VenueDoc | null;

    if (!venue) {
      console.log(`  NOT FOUND: "${figure.name}"`);
      notFound += 1;
      continue;
    }

    const updateData: Record<string, unknown> = { payAmount: figure.payAmount };

    // For Botetourt Farmers Market, append the note instead of overwriting
    if (figure.noteToAdd) {
      const currentNotes = venue.notes || '';
      // Only append the note if it's not already present (idempotency check)
      if (!currentNotes.includes(figure.noteToAdd)) {
        const newNotes = currentNotes ? `${currentNotes} ${figure.noteToAdd}` : figure.noteToAdd;
        updateData.notes = newNotes;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    await venueModel.findByIdAndUpdate(String(venue._id), updateData);
    console.log(`  FOUND & UPDATED: "${figure.name}" payAmount=${figure.payAmount}${figure.noteToAdd ? ' + note appended' : ''}`);
    found += 1;
  }

  console.log(`\n${found} venue(s) found and updated; ${notFound} not found (no records changed for those).`);

  await mongoose.connection.close();
}

// Only auto-execute when run directly — NOT when imported by a unit test.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
/* istanbul ignore if -- exercised only when the script is executed directly, never under vitest */
if (isMain) {
  run().catch((err) => {
    console.error('Script failed:', (err as Error).message);
    process.exit(1);
  });
}

export { run, VENUE_FIGURES };

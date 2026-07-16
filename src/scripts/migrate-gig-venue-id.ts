// src/scripts/migrate-gig-venue-id.ts — web-jam-back#958
//
// Backfills `venueId` onto gig records that don't have one yet, by matching
// the gig's free-text `venue` name against `venue.name` using the shared
// EXACT normalized-name match (case/punctuation-insensitive, never fuzzy —
// see src/lib/gig-venue-link.ts). A gig whose normalized venue name matches
// zero or MORE THAN ONE venue is left unlinked (ambiguous matches are never
// guessed).
//
// Idempotent: only considers gigs with no venueId yet, so a re-run after a
// prior --apply only touches what's still unlinked. Read-only DRY RUN by
// default — prints exactly what it would change; pass --apply to write.
//
// SAFETY GUARD (mirrors scripts/restore-backup.mjs): this migration writes
// venueId onto real gig history, so — unlike migrate-target-weekend.ts (which
// is explicitly meant to eventually run against prod, protected only by its
// dry-run default) — it refuses to run at all against anything that doesn't
// look like local/DEV/TEST (db name containing 'dev'/'test', or
// localhost/127.0.0.1) unless --force is passed. Running it for real against
// prod is a deliberate act: `--force --apply` together, run manually (e.g.
// `heroku run node build/src/scripts/migrate-gig-venue-id.js -- --force
// --apply`) — never wired into build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:gig-venue-id                    # dry run against DEV/local
//   npm run migrate:gig-venue-id -- --apply          # writes, DEV/local only
//   npm run migrate:gig-venue-id -- --force --apply  # writes for real (prod)

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import gigModel from '#src/model/gig/gig-facade.js';
import venueModel from '#src/model/venue/venue-facade.js';
import {
  JOSH_GIGS_FILTER, buildUnambiguousNameIndex, normalizeVenueName, type LinkableGig, type LinkableVenue,
} from '#src/lib/gig-venue-link.js';

config(); // load .env if present

interface Args { apply: boolean; force: boolean }
function parseArgs(argv: string[]): Args {
  return { apply: argv.includes('--apply'), force: argv.includes('--force') };
}

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────
// Mirrors scripts/restore-backup.mjs's guard exactly: only db names/hosts that
// look local/DEV/TEST are allowed without --force. Returns true when safe to
// proceed, false when blocked — a pure predicate (no process.exit) so it's
// unit-testable; run() below is what actually exits the process.
export function isSafeToRun(uri: string, force: boolean): boolean {
  const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
  const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
  const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
  return isLocal || isDevOrTest || force;
}

async function run(): Promise<void> {
  const { apply, force } = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_DB_URI || '';
  const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@'); // eslint-disable-line sonarjs/slow-regex
  if (!isSafeToRun(uri, force)) {
    const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
    console.error('ERROR: migrate-gig-venue-id only runs against a local, DEV, or TEST database by default — never release/production.');
    console.error(`Target MONGO URI: ${maskedUri}`);
    console.error(`Parsed database name: ${dbName || '(none)'}`);
    console.error('Pass --force to run against a different database anyway (a deliberate, reviewed prod backfill).');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  const venues = (await venueModel.find({})) as unknown as LinkableVenue[];
  const nameIndex = buildUnambiguousNameIndex(venues);

  const candidates = (await gigModel.find({
    ...JOSH_GIGS_FILTER, venueId: { $exists: false },
  })) as unknown as LinkableGig[];

  let matched = 0;
  let ambiguousOrUnmatched = 0;
  let applied = 0;
  for (const gig of candidates) {
    const key = normalizeVenueName(gig.venue);
    const venueId = key ? nameIndex.get(key) : undefined;
    if (!venueId) { ambiguousOrUnmatched += 1; continue; }
    matched += 1;
    const label = `${apply ? 'WRITE' : 'PLAN'}: gig ${String(gig._id)} venue="${gig.venue}" -> venueId ${venueId}`;
    console.log(`  ${label}`);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await gigModel.findByIdAndUpdate(String(gig._id), { venueId });
      applied += 1;
    }
  }

  console.log(`\n${candidates.length} gig(s) scanned (no venueId yet); ${matched} matched exactly one venue by name; `
    + `${ambiguousOrUnmatched} left unlinked (no match or ambiguous).`);
  console.log(apply
    ? `${applied} gig(s) updated.`
    : `Dry run — ${matched} gig(s) WOULD be updated. Re-run with --apply to write for real.`);

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

export { parseArgs, run };

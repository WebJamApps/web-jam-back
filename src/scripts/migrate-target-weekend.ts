// src/scripts/migrate-target-weekend.ts — web-jam-back#923
//
// Backfills the new `targetWeekend` field onto LEGACY outreach records whose
// free-text `targetDates` matches one of the known prod variants from the
// root-cause writeup (#923 — the dedup guard used to compare targetDates as a
// STRING, so the same weekend typed three different ways across send batches
// never deduped against itself):
//   - 'Sept 25 to 27' / 'Sep 25-27' / starts with 'Friday, September 25'
//       -> targetWeekend { 2026-09-25 .. 2026-09-27 }
//   - starts with 'the weekend of Aug 14'
//       -> targetWeekend { 2026-08-14 .. 2026-08-16 }
//
// Idempotent: only considers records with NO targetWeekend yet, so a re-run
// after a prior --apply is a no-op (nothing left to match). Read-only DRY RUN
// by default — prints exactly what it would change; pass --apply to write.
//
// NO status/outcome fields are touched, ever. The runaway-period venues'
// actual outcomes (replies, the Sept 26 booking) are recorded BY JOSH through
// the Phase-1 UI (JaMmusic#1194) as its first real-world test — never by
// script/DB surgery (2026-07-10 design decision, issue #923).
//
// Guard style mirrors scripts/seed-outreach.mjs's env-guard pattern (masked
// URI + resolved db name printed up front, so a human reviewing output can
// always see exactly what it's connected to) — inverted target: seed-outreach
// exists to keep dev-only tooling OFF prod; this script's whole purpose is
// eventually running against prod, so nothing here blocks that. The DRY-RUN
// default is this script's real safety net (per [[prod-migration-safety]]):
// nothing writes until a human reviews the printed plan and re-runs with
// --apply. Run manually only (e.g. `heroku run node build/src/scripts/
// migrate-target-weekend.js -- --apply`) — never wired into build/postinstall/
// Procfile/CI.
//
// Usage:
//   npm run migrate:target-weekend              # dry run — prints the plan
//   npm run migrate:target-weekend -- --apply    # writes for real

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';
import outreachModel from '#src/model/outreach/outreach-facade.js';

config(); // load .env if present (harmless no-op when env vars are already set, e.g. on Heroku)

export interface WeekendRange { start: Date; end: Date }

const SEPTEMBER_WEEKEND: WeekendRange = { start: new Date('2026-09-25'), end: new Date('2026-09-27') };
const AUGUST_WEEKEND: WeekendRange = { start: new Date('2026-08-14'), end: new Date('2026-08-16') };

// The three September free-text variants seen in prod (root-cause writeup,
// #923): typed differently per send batch (6/23, 7/2-3, 7/4, 7/5), same
// intended weekend.
export function isSeptemberVariant(targetDates: string): boolean {
  const t = targetDates.trim();
  return t === 'Sept 25 to 27' || t === 'Sep 25-27' || t.startsWith('Friday, September 25');
}

// The halted-Aug-batch variant (the 5 mis-sent records).
export function isAugustVariant(targetDates: string): boolean {
  return targetDates.trim().startsWith('the weekend of Aug 14');
}

// Resolve the target weekend a legacy record's free-text targetDates implies,
// or null when it matches neither known variant (left untouched).
export function resolveWeekend(targetDates: string | undefined | null): WeekendRange | null {
  if (!targetDates) return null;
  if (isSeptemberVariant(targetDates)) return SEPTEMBER_WEEKEND;
  if (isAugustVariant(targetDates)) return AUGUST_WEEKEND;
  return null;
}

function fmt(d: Date): string { return d.toISOString().slice(0, 10); }

interface OutreachDoc { _id: unknown; targetDates?: string }

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_DB_URI || '';
  // `\/\/[^@]+@` is linear (negated class, single quantifier, no nested
  // backtracking) — safe despite the generic slow-regex warning (mirrors the
  // same masking regex in scripts/seed-outreach.mjs).
  // eslint-disable-next-line sonarjs/slow-regex
  const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  // Idempotent: only records missing targetWeekend are even candidates.
  const candidates = (await outreachModel.find({
    targetWeekend: { $exists: false }, targetDates: { $exists: true, $ne: '' },
  })) as unknown as OutreachDoc[];

  let matched = 0;
  let applied = 0;
  for (const doc of candidates) {
    const weekend = resolveWeekend(doc.targetDates);
    if (!weekend) continue;
    matched += 1;
    const label = `${apply ? 'WRITE' : 'PLAN'}: ${String(doc._id)} targetDates="${doc.targetDates}" `
      + `-> targetWeekend ${fmt(weekend.start)}..${fmt(weekend.end)}`;
    console.log(`  ${label}`);
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await outreachModel.findByIdAndUpdate(String(doc._id), { targetWeekend: weekend });
      applied += 1;
    }
  }

  console.log(`\n${candidates.length} record(s) scanned (missing targetWeekend); ${matched} matched a known variant.`);
  console.log(apply
    ? `${applied} record(s) updated.`
    : `Dry run — ${matched} record(s) WOULD be updated. Re-run with --apply to write for real.`);

  await mongoose.connection.close();
}

// Only auto-execute when run directly (`node build/src/scripts/migrate-target-
// weekend.js`) — NOT when imported (e.g. by a unit test exercising the pure
// matcher functions above), so importing this module never touches Mongo.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
/* istanbul ignore if -- exercised only when the script is executed directly, never under vitest */
if (isMain) {
  run().catch((err) => {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  });
}

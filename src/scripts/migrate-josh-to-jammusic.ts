// src/scripts/migrate-josh-to-jammusic.ts — web-jam-back#1058
//
// One-time re-tag: Josh & Maria's 138 gig records carry `artist: 'josh'`
// explicitly (originally stamped that way by the #897a wj-prod restore, see
// scripts/transforms/josh-migration.mjs), which disagrees with this
// backend's shared DEFAULT_ARTIST convention (`'jammusic'`,
// src/lib/artist.ts). Because artistListFilter's default-tenant $or only
// matches a missing artist field, null, or the literal 'jammusic', a plain
// `GET /gig` with no ?artist= query returns an empty array for these 138
// records today even though they exist. This migration re-tags every
// `artist: 'josh'` gig to `artist: 'jammusic'` so the stored data and the
// shared default finally agree. `tim`-tagged and field-less (pre-#885)
// records are never touched — the query is scoped to `artist: 'josh'` only.
//
// MUST run only after BOTH of these are deployed (see web-jam-back#1058):
//   - WebJamSocketCluster#276 — widens the socket service's OWN default-
//     artist filter to match 'jammusic' too, so joshandmariamusic.com's live
//     calendar (served over the socket, not this backend) doesn't go empty
//     the moment these records are re-tagged.
//   - JaMmusic#1331 — stops the admin UI from re-stamping 'josh' on gig
//     create/edit, so a gig edited after this migration runs stays on
//     'jammusic' instead of reverting.
//
// `artist` is a normal, still-defined schema field (src/model/gig/gig-
// schema.ts), so this writes through the ordinary mongoose Model — no raw-
// collection workaround needed (unlike the #954/#980 migrations, which
// $unset fields already dropped from their schema).
//
// Idempotent: only considers gigs still carrying `artist: 'josh'`, so a
// re-run after a prior --apply finds zero candidates and changes nothing.
// Read-only DRY RUN by default — prints exactly what it would change; pass
// --apply to write.
//
// SAFETY GUARD (mirrors every sibling migrate-*.ts): refuses to run at all
// against anything that doesn't look like local/DEV/TEST (db name containing
// 'dev'/'test', or localhost/127.0.0.1) unless --force is passed. Running it
// for real against prod is a deliberate act, run manually post-merge with
// Josh's explicit go, AFTER confirming both blocking prerequisites above are
// deployed (e.g. `heroku run "npm run migrate:josh-to-jammusic -- --force"
// -a webjamsalem` for the dry run, then `--force --apply` to write) — never
// wired into build/postinstall/Procfile/CI.
//
// Usage:
//   npm run migrate:josh-to-jammusic                    # dry run, DEV/local
//   npm run migrate:josh-to-jammusic -- --apply          # writes, DEV/local only
//   npm run migrate:josh-to-jammusic -- --force --apply  # writes for real (prod)

import { config } from 'dotenv';
import mongoose from 'mongoose';
import gigModel from '#src/model/gig/gig-facade.js';
import { guardOrExit, isMainModule } from '#src/lib/migration-cli.js';
import { DEFAULT_ARTIST } from '#src/lib/artist.js';

config(); // load .env if present

// The pre-#1058 slug being retired. Never 'tim' and never field-less — this
// filter is deliberately narrow so neither of those is ever a candidate.
export const OLD_ARTIST = 'josh';
const FILTER = { artist: OLD_ARTIST };

interface GigDoc { _id: unknown; venue?: string }

async function run(): Promise<void> {
  const { apply, uri, maskedUri } = guardOrExit('migrate-josh-to-jammusic', 'migrate:josh-to-jammusic');

  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${maskedUri})`);
  console.log(apply ? 'Mode: APPLY — writes will happen.' : 'Mode: DRY RUN — no writes (pass --apply to write).');

  const candidates = (await gigModel.find(FILTER)) as unknown as GigDoc[];
  for (const gig of candidates) {
    const verb = apply ? 'WRITE' : 'PLAN';
    console.log(`  ${verb}: gig ${String(gig._id)} "${gig.venue || ''}" artist "${OLD_ARTIST}" -> "${DEFAULT_ARTIST}"`);
  }

  let modifiedCount = 0;
  if (apply && candidates.length) {
    const res = await gigModel.Schema.updateMany(FILTER, { artist: DEFAULT_ARTIST });
    modifiedCount = res.modifiedCount || 0;
  }

  console.log(`\n${candidates.length} gig(s) scanned (still carried artist:"${OLD_ARTIST}").`);
  console.log(apply
    ? `${modifiedCount} gig(s) updated.`
    : `Dry run — ${candidates.length} gig(s) WOULD be updated. Re-run with --apply to write for real.`);

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

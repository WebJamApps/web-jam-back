#!/usr/bin/env node
// scripts/restore-backup.mjs — restore an EJSON export (written by
// `POST /admin/backup`, web-jam-tools#116) back into a target Mongo database.
//
// Usage:
//   node scripts/restore-backup.mjs --folder <path/to/run-folder> [--db webjamsalem|webjamsocket] [--uri <mongo-uri>] [--transform <path-to-module>] [--force]
//
// <run-folder> is one dated export folder (e.g. what the backup route or a
// local drill wrote): it contains `webjamsalem/` and/or `webjamsocket/`
// subfolders of `<collection>.ndjson` files (one EJSON document per line) and a
// manifest.json.
//
// Defaults: --db webjamsalem, --uri from MONGO_DB_URI (locally, the DEV Atlas
// cluster from .env — see the local-dev-uses-dev-atlas convention: this laptop
// never points at prod). Both --uri and --db are already fully parameterized
// (not hardcoded to one database), so this same script is what web-jam-tools#897
// will point at web-jam-data when migrating wj-prod's collections there.
//
// SAFETY GUARD (mirrors scripts/seed-outreach.mjs): refuses to run against
// anything that doesn't look like local/dev/test unless --force is passed —
// writing into a live database should be a deliberate, explicit act, never an
// accidental default.
//
// For each collection found in the export: DROPS the target collection (a
// restore is a REPLACE, not a merge) then reinserts every exported document,
// rebuilds the indexes the record definitions declare, and prints per
// collection the count restored beside the count in the run's manifest.json,
// plus any index that existed before the restore and is gone after. The files'
// record counts are checked against manifest.json first; any difference stops
// the restore with nothing changed.
//
// ONE MODULE (web-jam-back#1144): the work is done by
// src/model/backup/backup-restore.ts, the same module the production route
// (POST /admin/backup/runs/:name/restore) calls. This script imports its
// compiled form through the `#src/*` imports map, so run
// `npx tsc -p tsconfig.prod.json` first.
//
// TRANSFORM SEAM (for web-jam-tools#897): --transform <path> dynamically
// imports a module whose default export is a per-document hook,
// `(doc, collectionName) => result`, run on every document immediately after
// EJSON.parse and before insertMany. `result` is one of:
//   - a plain document object  -> inserted into the SAME collection as the
//     source file (this is what an identity/#116 passthrough returns).
//   - `null` or `undefined`    -> the document is DROPPED (not inserted
//     anywhere).
//   - `{ collection, doc }`    -> the document is redirected: `doc` is
//     inserted into `collection` instead of the source file's collection
//     name (e.g. #897's book -> jamPics filtered remap).
// With no --transform every document is inserted unchanged. A source
// collection is only touched (dropped + reinserted) if at least one
// document actually resolves to it — so a collection that's entirely
// redirected/dropped (like #897's `book`) is never created or cleared in the
// target database. See docs/mongo-backup.md and
// scripts/transforms/josh-migration.mjs (the #897 implementation).

import { config } from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

config(); // load .env if present

function parseArgs(argv) {
  const out = { db: 'webjamsalem' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--folder') { out.folder = argv[i + 1]; i += 1; } else if (a === '--db') { out.db = argv[i + 1]; i += 1; } else if (a === '--uri') { out.uri = argv[i + 1]; i += 1; } else if (a === '--transform') { out.transform = argv[i + 1]; i += 1; } else if (a === '--force') { out.force = true; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.folder) {
  console.error('Usage: node scripts/restore-backup.mjs --folder <run-folder> [--db webjamsalem|webjamsocket] [--uri <mongo-uri>] [--transform <path-to-module>] [--force]');
  process.exit(1);
}

// Transform seam (web-jam-tools#897): loads a module's default export as a
// `(doc, collectionName) => result` hook, or undefined (no transform) if
// --transform wasn't passed. See the file-header comment and docs/mongo-backup.md.
async function loadTransform(modulePath) {
  if (!modulePath) return undefined;
  const mod = await import(path.resolve(modulePath));
  return mod.default;
}

const uri = args.uri || process.env.MONGO_DB_URI || 'mongodb://localhost:27017/web-jam-dev';
const dbDir = path.join(args.folder, args.db);
if (!fs.existsSync(dbDir)) {
  console.error(`ERROR: no export found for db "${args.db}" at ${dbDir}`);
  process.exit(1);
}

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────
const maskedUri = uri.replace(/\/\/[^@]+@/, '//<masked>@');
const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
if (!isLocal && !isDevOrTest && !args.force) {
  console.error('ERROR: restore-backup only runs against a local, DEV, or TEST database by default — never release/production.');
  console.error(`Target MONGO URI: ${maskedUri}`);
  console.error(`Parsed database name: ${dbName || '(none)'}`);
  console.error('Pass --force to restore into a different database anyway (e.g. a real disaster-recovery restore).');
  process.exit(1);
}

// The run folder's manifest.json, when it has one: the counts the files are checked against.
function manifestCountsFor(folder, db) {
  const file = path.join(folder, 'manifest.json');
  if (!fs.existsSync(file)) return undefined;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  return manifest.databases?.[db]?.collections;
}

async function loadRestoreModule() {
  try {
    return await import('#src/model/backup/backup-restore.js');
  } catch (e) {
    console.error(`ERROR: cannot load the compiled restore module (${e.message}).`);
    console.error('Run `npx tsc -p tsconfig.prod.json` first, then retry.');
    process.exit(1);
    return undefined;
  }
}

async function main() {
  const restore = await loadRestoreModule();
  console.log(`Restoring "${args.db}" export from ${dbDir}`);
  console.log(`  into ${maskedUri} (database: ${dbName || '(default)'})`);
  const transform = await loadTransform(args.transform);
  const manifestCounts = manifestCountsFor(args.folder, args.db);
  if (!manifestCounts) console.log('  (no manifest.json counts for this database — files are not checked against a manifest)');

  await restore.registerDeclaredModels(fileURLToPath(new URL('../build/src/model', import.meta.url)));
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    const result = await restore.restoreFromFolder({
      db: conn.db,
      folder: dbDir,
      manifestCounts,
      transform,
      rebuildIndexes: restore.mongooseIndexRebuilder(conn),
      onProgress: (step) => console.log(`  ${step} ...`),
    });

    console.log('\nRestore complete. Per collection, restored | in manifest:');
    for (const row of result.collections) {
      console.log(`  ${row.collection}: ${row.restored} | ${row.manifest ?? 'n/a'}`);
    }
    if (result.indexFailures.length > 0) {
      console.log('\nDeclared indexes that could not be built (the data is restored; later indexes of that collection may not have been built either):');
      for (const f of result.indexFailures) console.log(`  ${f.collection}: ${f.message}`);
    }
    if (result.missingIndexes.length > 0) {
      console.log('\nIndexes present before the restore and absent after (not re-created):');
      for (const m of result.missingIndexes) console.log(`  ${m.collection}: ${m.index}`);
    }
  } finally {
    await conn.close();
  }
}

main().catch((e) => {
  console.error(e.name === 'RestoreRefusal' ? `Restore refused, nothing changed (${e.guard}): ${e.message}` : `Restore failed: ${e.message}`);
  process.exit(1);
});

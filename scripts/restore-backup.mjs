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
// restore is a REPLACE, not a merge — safe because dev is disposable by
// design) then reinserts every exported document. Prints per-collection
// document counts so they can be checked against the export's manifest.json.
// NOTE: Mongoose re-creates indexes on the app's next boot; this script does
// not attempt to recreate them itself.
//
// TRANSFORM SEAM (for web-jam-tools#897): --transform <path> dynamically
// imports a module whose default export is `(doc, collectionName) => doc`,
// run on every document immediately after EJSON.parse and before insertMany.
// Defaults to an identity passthrough, so plain #116 restores are unaffected.
// #897 will use this (not implemented here) to add an `artist` field to
// migrated documents on the way into web-jam-data — see docs/mongo-backup.md.

import { config } from 'dotenv';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

config(); // load .env if present

const { EJSON } = mongoose.mongo.BSON;

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
// `(doc, collectionName) => doc` hook, or a no-op passthrough if --transform
// wasn't passed. See the file-header comment and docs/mongo-backup.md.
async function loadTransform(modulePath) {
  if (!modulePath) return (doc) => doc;
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
const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@');
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

async function restoreCollection(db, name, filePath, transform) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const docs = lines.map((line) => transform(EJSON.parse(line), name));
  try { await db.dropCollection(name); } catch { /* collection didn't exist yet — fine */ }
  if (docs.length === 0) return 0;
  const result = await db.collection(name).insertMany(docs, { ordered: false });
  return result.insertedCount;
}

async function main() {
  console.log(`Restoring "${args.db}" export from ${dbDir}`);
  console.log(`  into ${maskedUri} (database: ${dbName || '(default)'})`);
  const transform = await loadTransform(args.transform);
  const conn = await mongoose.createConnection(uri).asPromise();
  const { db } = conn;
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.ndjson')).sort();
  const counts = {};
  for (const file of files) {
    const name = file.replace(/\.ndjson$/, '');
    // eslint-disable-next-line no-await-in-loop
    counts[name] = await restoreCollection(db, name, path.join(dbDir, file), transform);
  }
  await conn.close();

  console.log('\nRestore complete. Per-collection document counts:');
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name}: ${count}`);
  }
  console.log('\nNOTE: Mongoose re-creates indexes on the app\'s next boot — run `npm run dev` (or `npm start`) against this database next to verify.');
}

main().catch((e) => {
  console.error('Restore failed:', e.message);
  process.exit(1);
});

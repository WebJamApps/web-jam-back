#!/usr/bin/env node
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

class CleanupRefusal extends Error {}

export async function clearNextTouchDates({ collection, apply = false, confirm, log = console.log }) {
  const records = await collection.find(
    { status: 'sent', nextTouchDue: { $exists: true, $ne: null } },
    { projection: { _id: 1, nextTouchDue: 1 } },
  ).toArray();
  const count = records.length;
  log('| Status | Records | Change |');
  log('| --- | ---: | --- |');
  log(`| sent | ${count} | Set nextTouchDue to null |`);

  if (!apply) {
    log('DRY RUN: no dates cleared. Use --apply in an interactive terminal to approve the table.');
    return 0;
  }
  if (count === 0) {
    log('No leftover next-touch dates to clear.');
    return 0;
  }
  const approval = `clear ${count}`;
  const answer = await confirm(`Type "${approval}" to approve this table, or press Enter to decline: `);
  if (answer.trim() !== approval) {
    log('Approval declined. No dates cleared.');
    return 0;
  }

  // Match each approved record and its previewed value at update time. Use the
  // native collection so Mongoose does not also write updated_at or defaults.
  const operations = records.map(({ _id, nextTouchDue }) => ({
    updateOne: {
      filter: { _id, status: 'sent', nextTouchDue },
      update: { $set: { nextTouchDue: null } },
    },
  }));
  const { modifiedCount } = await collection.bulkWrite(operations, { writeConcern: { w: 'majority' } });
  log(`Cleared ${modifiedCount} of ${count} approved next-touch date(s).`);
  return modifiedCount;
}

async function main() {
  let options;
  try {
    ({ values: options } = parseArgs({ options: {
      apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
    } }));
  } catch {
    throw new CleanupRefusal('Use --dry-run, --apply, or --help.');
  }
  if (options.apply && options['dry-run']) throw new CleanupRefusal('Choose --dry-run or --apply.');
  if (options.help) {
    console.log('Usage: npm run clear:next-touch-dates -- [--dry-run | --apply]');
    console.log('Requires MONGO_DB_URI in the environment. --apply requires interactive table approval.');
    return;
  }
  if (options.apply && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new CleanupRefusal('--apply requires an interactive terminal.');
  }
  const uri = process.env.MONGO_DB_URI;
  if (!uri) throw new CleanupRefusal('MONGO_DB_URI is required in the environment.');

  const { default: mongoose } = await import('mongoose');
  let terminal;
  try {
    await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 });
    console.log(`Database: ${mongoose.connection.name}`);
    const collection = mongoose.connection.db.collection(mongoose.pluralize()('Outreach'));
    if (options.apply) terminal = createInterface({ input: process.stdin, output: process.stdout });
    await clearNextTouchDates({ collection, apply: options.apply, confirm: (question) => terminal.question(question) });
  } finally {
    terminal?.close();
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Driver errors may include the connection URI.
    console.error(error instanceof CleanupRefusal
      ? `Next-touch cleanup refused: ${error.message}`
      : 'Next-touch cleanup failed. Run a dry run before retrying.');
    process.exitCode = 1;
  });
}

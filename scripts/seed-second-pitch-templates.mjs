#!/usr/bin/env node
// Run after compiling (npm exec tsc -- -p tsconfig.prod.json).
// Dry run by default. Only an interactive approval can insert missing templates;
// existing copy, including inactive templates, is always preserved.
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

class SeedInputError extends Error {}

// The former cadence follow-up copy, moved into editable template slots.
export const SECOND_PITCH_TEMPLATES = ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'].map((type) => ({
  type,
  stage: 'second-pitch',
  subject: 'Following up - Josh & Maria at [Venue Name]',
  introHtml: '<p>Hi [Contact Name],</p>\n'
    + '<p>Just following up on my note from [First Pitch Date] about Josh &amp; Maria — my wife and I are a husband-wife '
    + "acoustic duo here in Salem, VA. We'd still love to be considered for a slot at [Venue Name] around [Target Dates].</p>",
  bodyHtml: '[Custom Body]'
    + "<p>Completely understand if the calendar's full; even a later window would be great. "
    + 'Happy to send more live samples or work around your schedule.</p>\n'
    + '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br>'
    + '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
  footerPhotoRef: 'footer-josh-maria',
  active: true,
  lastModifiedBy: 'seed-second-pitch-templates',
}));

export function parseArgs(argv) {
  if (argv.some((arg) => !['--apply', '--dry-run', '--help'].includes(arg))) throw new SeedInputError('Unknown option');
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new SeedInputError('Choose --apply or --dry-run');
  return { apply: argv.includes('--apply'), help: argv.includes('--help') };
}

// Keep the complete copy visible in one Markdown table; terminal renderers must
// not truncate long cells as console.table does. Existing records are read at
// every stage/active value so a deliberately disabled template is never revived.
function tableCell(value) {
  return String(value ?? '').replaceAll('|', '&#124;').replaceAll('\n', '<br>');
}

function printProposal(rows, log) {
  log('| Row | Type | Action | Subject | Intro HTML | Body HTML | Footer | Active |');
  log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { number, existing, template } of rows) {
    const displayed = existing || template;
    log(`| ${[number, template.type, existing ? 'Keep existing' : 'Insert second-pitch',
      displayed.subject, displayed.introHtml, displayed.bodyHtml, displayed.footerPhotoRef,
      displayed.active].map(tableCell).join(' | ')} |`);
  }
}

export function approvedRows(answer, rows) {
  const pending = rows.filter((row) => !row.existing);
  const value = answer.trim().toLowerCase();
  if (value === 'all') return pending;
  if (!value || value === 'none') return [];
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(value)) throw new SeedInputError('Approval must be all, none, or comma-separated row numbers');
  const numbers = [...new Set(value.split(',').map(Number))];
  if (numbers.some((number) => !pending.some((row) => row.number === number))) {
    throw new SeedInputError('Approval names a row that is not a proposed insert');
  }
  return pending.filter((row) => numbers.includes(row.number));
}

// Dependency injection keeps tests entirely off any database and exercises the
// same approval boundary as the CLI. $setOnInsert preserves copy even if another
// operator creates a template between the preview and this approved insert.
export async function seedSecondPitchTemplates({ model, apply = false, confirm, log = console.log }) {
  const existing = await model.find({ stage: 'second-pitch' }).lean().exec();
  const rows = SECOND_PITCH_TEMPLATES.map((template, index) => ({
    number: index + 1, template, existing: existing.find((doc) => doc.type === template.type),
  }));
  printProposal(rows, log);
  if (!apply) {
    log('DRY RUN: no templates written. Use --apply in an interactive terminal to approve rows.');
    return 0;
  }
  if (rows.every((row) => row.existing)) {
    log('All second-pitch templates already exist; no templates written.');
    return 0;
  }
  const approved = approvedRows(await confirm('Approve inserts from this table (all, 1,3, or none): '), rows);
  let inserted = 0;
  for (const { template } of approved) {
    const now = new Date();
    const result = await model.updateOne(
      { type: template.type, stage: template.stage },
      { $setOnInsert: { ...template, created_at: now, updated_at: now } },
      { upsert: true, runValidators: true, timestamps: false },
    );
    inserted += result.upsertedCount;
    log(`${template.type}/second-pitch: ${result.upsertedCount ? 'inserted' : 'kept existing'}`);
  }
  log(`Inserted ${inserted} second-pitch template(s).`);
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run seed:second-pitch-templates -- [--dry-run | --apply]');
    console.log('Requires MONGO_DB_URI and a compiled build. --apply requires interactive table approval.');
    return;
  }
  if (args.apply && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new SeedInputError('--apply requires an interactive terminal');
  }
  const { config } = await import('dotenv');
  config({ quiet: true });
  if (!process.env.MONGO_DB_URI) throw new SeedInputError('MONGO_DB_URI is required');
  const { default: mongoose } = await import('mongoose');
  // Neither connection nor model initialization may mutate indexes/collections
  // before approval, including a dry run against production.
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
  const { default: model } = await import('#src/model/template/template-schema.js');
  let terminal;
  try {
    await mongoose.connect(process.env.MONGO_DB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log(`Database: ${mongoose.connection.name}`);
    if (args.apply) terminal = createInterface({ input: process.stdin, output: process.stdout });
    await seedSecondPitchTemplates({ model, apply: args.apply, confirm: (question) => terminal.question(question) });
  } finally {
    terminal?.close();
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Driver errors can contain the connection URI. Never log them or credentials.
    console.error(error instanceof SeedInputError
      ? `Second-pitch seed refused: ${error.message}`
      : 'Second-pitch seed failed. Check compiled build, database access and template indexes. No emails sent.');
    process.exitCode = 1;
  });
}

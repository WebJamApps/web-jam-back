#!/usr/bin/env node
// scripts/seed-outreach.mjs — idempotent seed for local Batch Outreach testing (#1149).
//
// Usage:  npm run seed:outreach
//
// SAFETY GUARD (critical): only runs against a local Mongo (localhost/127.0.0.1)
// or a DEV/TEST database (db name contains 'dev' or 'test'). It must NEVER touch
// the 'release' (production) database. DEV Atlas is the normal local-dev target.
//
// Idempotent: uses upserts keyed on natural identifiers (Template by type+stage;
// Venue by email; OutreachConfig by key:'outreach'; Outreach by venueId+targetDates).
// Re-running the script does NOT duplicate data.
//
// Schemas are defined inline (matching src/model/*/.*-schema.ts) because tsx/ts-node
// are not devDependencies and the compiled build/ is not guaranteed to exist.
// Keep these in sync with the source schemas when they change.

import { config } from 'dotenv';
import mongoose from 'mongoose';

config(); // load .env if present

const uri = process.env.MONGO_DB_URI || 'mongodb://localhost:27017/web-jam-dev';

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────
const maskedUri = uri.replace(/\/\/[^@]+@/, '//<credentials>@');
const dbName = (uri.split('?')[0].split('/').pop() || '').toLowerCase();
const isLocal = uri.includes('localhost') || uri.includes('127.0.0.1');
const isDevOrTest = dbName.includes('dev') || dbName.includes('test');
if (!isLocal && !isDevOrTest) {
  console.error('ERROR: seed:outreach only runs against a local, DEV, or TEST database — never release/production.');
  console.error(`Current MONGO_DB_URI: ${maskedUri}`);
  console.error(`Parsed database name: ${dbName || '(none)'}`);
  console.error('Point MONGO_DB_URI at your DEV Atlas DB (db name containing "dev" or "test") or a local Mongo.');
  process.exit(1);
}

// ── Schema mirrors (kept in sync with src/model/*/.*-schema.ts) ─────────────

const { Schema } = mongoose;

// mirror: src/model/template/template-schema.ts — unique index on (type, stage)
const templateSchema = new Schema({
  type: { type: String, required: true, enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar', 'OnlineForm'] },
  stage: { type: String, enum: ['cold', 'returning'], default: 'cold' },
  subject: String,
  bodyHtml: String,
  footerPhotoRef: String,
  active: { type: Boolean, default: true },
  lastModifiedBy: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
templateSchema.index({ type: 1, stage: 1 }, { unique: true });

// mirror: src/model/venue/venue-schema.ts
const venueSchema = new Schema({
  name: { type: String, required: true },
  city: String,
  usState: String,
  venueType: { type: String, enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'] },
  contactName: String,
  email: { type: String, lowercase: true, trim: true },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  outreachEligible: { type: Boolean, default: false },
  inScope: { type: Boolean, default: true },
  bookingStatus: { type: String, enum: ['booking', 'not-booking', 'booked'], default: 'booking' },
  interested: { type: Boolean, default: true },
  relationshipStage: { type: String, enum: ['cold', 'returning'] },
  templateOverride: { type: String, enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'] },
  lastModifiedBy: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// mirror: src/model/outreach/outreach-schema.ts (abridged — only fields seeded here)
const outreachSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  templateUsed: String,
  targetDates: String,
  bookingPeriod: String,
  sentAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['sent', 'replied', 'declined', 'booked', 'no-response'], default: 'sent' },
  step: { type: Number, default: 1 },
  nextTouchDue: { type: Date, default: null },
  followUps: { type: Array, default: [] },
  lastModifiedBy: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// mirror: src/model/outreach/outreach-config-schema.ts
const configSchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'outreach' },
  autoApprove: { type: Boolean, default: false },
  lastModifiedBy: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Singleton model pattern matching the real schema files.
const Template = mongoose.models.Template || mongoose.model('Template', templateSchema);
const Venue = mongoose.models.Venue || mongoose.model('Venue', venueSchema);
const Outreach = mongoose.models.Outreach || mongoose.model('Outreach', outreachSchema);
const OutreachConfig = mongoose.models.OutreachConfig || mongoose.model('OutreachConfig', configSchema);

// ── Seed data: 6 Templates (3 venueTypes × 2 stages) ────────────────────────

const templates = [
  {
    type: 'Originals', stage: 'cold',
    subject: 'Performance Inquiry: Josh & Maria at [Venue Name]',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>My name is Josh Sherman and I perform alongside my wife Maria as an acoustic duo',
      ' based in Salem, VA. We specialize in original music and love venues that value songwriting.</p>',
      '<p>We\'d love to be considered for a slot at [Venue Name] around [Target Dates].',
      ' Our [Booking Period] calendar is filling up and [Venue Name] would be a great fit.</p>',
      '<p>Happy to send samples or answer any questions.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
  {
    type: 'Originals', stage: 'returning',
    subject: 'Would love to return to [Venue Name] — Josh & Maria',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>We loved playing at [Venue Name] and would be thrilled to come back',
      ' for another show around [Target Dates] during [Booking Period].</p>',
      '<p>We have some new songs since our last visit and would love to share them with your crowd again.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
  {
    type: 'PubFestivalBrewery', stage: 'cold',
    subject: 'Live Music Inquiry — Josh & Maria for [Venue Name]',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>I\'m Josh Sherman — my wife Maria and I perform as an acoustic duo out of Salem, VA.',
      ' We play a crowd-pleasing mix of covers and originals, perfect for a pub or brewery atmosphere.</p>',
      '<p>We\'d love to play [Venue Name] around [Target Dates].',
      ' We\'re booking our [Booking Period] dates and think [Venue Name] would be a great fit.</p>',
      '<p>Happy to share samples!</p>',
      '<p>Cheers,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
  {
    type: 'PubFestivalBrewery', stage: 'returning',
    subject: 'We\'d love to return to [Venue Name] — Josh & Maria',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>Thank you again for having us at [Venue Name] — the crowd was fantastic.',
      ' We\'d love to come back around [Target Dates] if there\'s a spot available during [Booking Period].</p>',
      '<p>Same acoustic duo, same good energy.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
  {
    type: 'MidRangeCafeBar', stage: 'cold',
    subject: 'Acoustic Live Music for [Venue Name] — Josh & Maria',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>I\'m Josh Sherman — my wife Maria and I are an acoustic duo in Salem, VA.',
      ' We play original songs and acoustic covers, ideal for a relaxed café or bar setting.</p>',
      '<p>We\'d love to bring live music to [Venue Name] around [Target Dates]',
      ' — looks like a great spot for [Booking Period] entertainment.</p>',
      '<p>Thanks for your consideration!</p>',
      '<p>Warmly,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
  {
    type: 'MidRangeCafeBar', stage: 'returning',
    subject: 'Hope to play [Venue Name] again — Josh & Maria',
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>It was great playing at [Venue Name] — we\'d love to come back',
      ' around [Target Dates] for [Booking Period] if you have availability.</p>',
      '<p>Same acoustic duo, a few new songs, same good vibes.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br>',
      '<a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join(''),
    footerPhotoRef: 'footer-josh-maria', active: true, lastModifiedBy: 'seed-outreach',
  },
];

// ── Seed data: 5 Venues ──────────────────────────────────────────────────────

const venues = [
  {
    // Originals, cold, booking — will show as a candidate for Sept 25-27 (but has a
    // 'sent' outreach below, so the dedup-skip path is visible on the batch page).
    name: 'The Stage at Roanoke',
    city: 'Roanoke', usState: 'VA',
    venueType: 'Originals', contactName: 'Alex Rivera',
    email: 'booking@stageatroanoke.seed.example',
    status: 'active', outreachEligible: true, inScope: true,
    bookingStatus: 'booking', interested: true,
    lastModifiedBy: 'seed-outreach',
  },
  {
    // PubFestivalBrewery, cold, booking — clean candidate (no outreach yet).
    name: 'Blue Ridge Brewing',
    city: 'Roanoke', usState: 'VA',
    venueType: 'PubFestivalBrewery', contactName: 'Sam Estes',
    email: 'events@blueridgebrewing.seed.example',
    status: 'active', outreachEligible: true, inScope: true,
    bookingStatus: 'booking', interested: true,
    lastModifiedBy: 'seed-outreach',
  },
  {
    // MidRangeCafeBar, cold, booking — clean candidate (no outreach yet).
    name: 'Mossy Creek Cafe',
    city: 'Harrisonburg', usState: 'VA',
    venueType: 'MidRangeCafeBar', contactName: 'Jordan Lee',
    email: 'music@mossycreekcafe.seed.example',
    status: 'active', outreachEligible: true, inScope: true,
    bookingStatus: 'booking', interested: true,
    lastModifiedBy: 'seed-outreach',
  },
  {
    // Originals, explicitly returning — will receive the returning template; has a
    // 'replied' outreach below, so it shows up in the replies-to-review queue.
    name: 'The Hideaway Lounge',
    city: 'Salem', usState: 'VA',
    venueType: 'Originals', contactName: 'Dana Marsh',
    email: 'dana@hideawaylounge.seed.example',
    status: 'active', outreachEligible: true, inScope: true,
    bookingStatus: 'booking', interested: true,
    relationshipStage: 'returning', // explicit; bypasses auto-derive
    lastModifiedBy: 'seed-outreach',
  },
  {
    // PubFestivalBrewery with a templateOverride → exercises the override code path:
    // even though venueType is PubFestivalBrewery, it will receive the MidRangeCafeBar
    // template instead.
    name: 'Spotty Dog Taphouse',
    city: 'Lexington', usState: 'VA',
    venueType: 'PubFestivalBrewery', contactName: 'Pat Goodwin',
    email: 'live@spottydogtaphouse.seed.example',
    status: 'active', outreachEligible: true, inScope: true,
    bookingStatus: 'booking', interested: true,
    templateOverride: 'MidRangeCafeBar', // forces the MidRangeCafeBar template
    lastModifiedBy: 'seed-outreach',
  },
];

// ── Upsert helpers ───────────────────────────────────────────────────────────

async function upsertTemplate(data) {
  return Template.findOneAndUpdate(
    { type: data.type, stage: data.stage },
    { $set: data },
    { upsert: true, new: true },
  );
}

async function upsertVenue(data) {
  return Venue.findOneAndUpdate(
    { email: data.email },
    { $set: data },
    { upsert: true, new: true },
  );
}

async function upsertOutreach(filter, data) {
  return Outreach.findOneAndUpdate(filter, { $set: data }, { upsert: true, new: true });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(uri);
  console.log(`Connected to "${mongoose.connection.name}" (${uri})\n`);

  // 1. Templates — 6 total (3 venueTypes × cold/returning)
  let tUpserted = 0;
  for (const t of templates) {
    await upsertTemplate(t); // eslint-disable-line no-await-in-loop
    tUpserted++;
    console.log(`  template upserted: ${t.type}/${t.stage}`);
  }

  // 2. Venues — 5 total
  const venueRecords = [];
  let vUpserted = 0;
  for (const v of venues) {
    const doc = await upsertVenue(v); // eslint-disable-line no-await-in-loop
    venueRecords.push(doc);
    vUpserted++;
    console.log(`  venue upserted: "${v.name}" (${v.venueType}${v.relationshipStage ? ', ' + v.relationshipStage : ''}${v.templateOverride ? ', override→' + v.templateOverride : ''})`);
  }

  // 3. OutreachConfig — singleton
  await OutreachConfig.findOneAndUpdate(
    { key: 'outreach' },
    { $set: { key: 'outreach', autoApprove: false, lastModifiedBy: 'seed-outreach' } },
    { upsert: true, new: true },
  );
  console.log('  config upserted: key=outreach autoApprove=false');

  // 4. Outreach records — 2 total
  const stageVenue = venueRecords.find((v) => v && v.name === 'The Stage at Roanoke');
  const hideawayVenue = venueRecords.find((v) => v && v.name === 'The Hideaway Lounge');
  let oUpserted = 0;

  if (stageVenue && hideawayVenue) {
    // sent: visible dedup-skip path on the batch page when targetDates = 'Sept 25-27'
    await upsertOutreach(
      { venueId: stageVenue._id, targetDates: 'Sept 25-27' },
      {
        venueId: stageVenue._id, templateUsed: 'Originals',
        targetDates: 'Sept 25-27', bookingPeriod: 'September',
        status: 'sent', sentAt: new Date('2026-09-01T10:00:00Z'),
        step: 1, nextTouchDue: new Date('2026-09-08T10:00:00Z'),
        lastModifiedBy: 'seed-outreach',
      },
    );
    oUpserted++;
    console.log('  outreach upserted: "The Stage at Roanoke" / Sept 25-27 → status:sent');

    // replied: shows in the replies-to-review queue for the returning-stage venue
    await upsertOutreach(
      { venueId: hideawayVenue._id, targetDates: 'Sept 25-27' },
      {
        venueId: hideawayVenue._id, templateUsed: 'Originals',
        targetDates: 'Sept 25-27', bookingPeriod: 'September',
        status: 'replied', sentAt: new Date('2026-09-01T10:00:00Z'),
        step: 1, nextTouchDue: null,
        lastModifiedBy: 'seed-outreach',
      },
    );
    oUpserted++;
    console.log('  outreach upserted: "The Hideaway Lounge" / Sept 25-27 → status:replied');
  } else {
    console.warn('  outreach: SKIPPED — could not resolve expected venue records');
  }

  console.log(`
Seed complete:
  ${tUpserted} templates  (3 venueTypes × cold/returning)
  ${vUpserted} venues     (all outreachEligible:true, varied types/stages)
  1 OutreachConfig (autoApprove: false)
  ${oUpserted} outreach records (1 sent + 1 replied @ "Sept 25-27")

To exercise the Batch Outreach page:
  1. Start the app: npm run dev
  2. Navigate to /admin/outreach
  3. Enter targetDates "Sept 25-27" — The Stage at Roanoke will be deduped (already sent).
     Other venues will appear as candidates for batch preview + send.
`);

  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

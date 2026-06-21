/* eslint-disable no-console, no-await-in-loop, max-len */
import mongoose from 'mongoose';
import utils from '../../lib/utils.js';
import TemplateModel from './template-schema.js';

// Seeds the 3 already-approved pitch-email templates (web-jam-back#822), mirrored
// from Josh's canonical approved templates. Idempotent: upserts by `type`, so
// re-running updates in place (no duplicates). Run after deploy:
//   node build/src/model/template/seed-templates.js
//
// Personalization tokens [Contact Name] / [Venue Name] / [Booking Period] /
// [Target Dates] are filled at send time (#823). `footerPhotoRef` keys the
// repo-bundled assets/footer-josh-maria.jpg (inline-CID at send).
//
// NOTE: the "OnlineForm" type (Online Form Information Block) is a valid type but
// is NOT seeded here — its approved copy wasn't available at build time. Create
// it via POST /template once supplied.

const SEEDED_BY = 'seed-templates (web-jam-back#822)';
const FOOTER = 'footer-josh-maria';

export const TEMPLATES = [
  {
    type: 'Originals',
    subject: 'Performance Inquiry: Josh and Maria (Original Americana/Roots Duo)',
    footerPhotoRef: FOOTER,
    active: true,
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>My name is Josh Sherman, and I perform with my wife Maria as the husband-wife acoustic duo "Josh and Maria." We are based in Salem, VA, and we are long-time admirers of [Venue Name]\'s commitment to showcasing original music.</p>',
      '<p>We are currently booking our [Booking Period] run and would love to be considered for a slot on [Target Dates]. As an established regional act with over 12 years of experience, we offer a professional, tight set of original Americana and roots music that we think would be a perfect fit for your listening room environment.</p>',
      '<p>Maria and I have spent over eleven years honing our acoustic duo sound — close-harmony Americana and roots music built around our original songwriting. We\'ve released live recordings of songs like Dark Light, Misty Rainy Morning, and Good Enough, and have built a steady following across southwest Virginia at venues that take songwriting seriously. Listening rooms are where we feel most at home.</p>',
      '<p>A few live samples of our original songwriting:</p>',
      '<ul>',
      '  <li><a href="https://web-jam.com/music/songs?id=69fdcc4b586f5175c6db44a7">Dark Light (Original) — live at Salem Farmers Market</a></li>',
      '  <li><a href="https://web-jam.com/music/songs?id=5f5e6b7d13772f0004a091ad">Misty Rainy Morning (Original)</a></li>',
      '  <li><a href="https://web-jam.com/music/songs?id=69fdcf2b586f5175c6db44ab">Good Enough (Original) — live at Salem Farmers Market</a></li>',
      '</ul>',
      '<p>You can find our full repertoire and performance history at <a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a>.</p>',
      '<p>Thank you for your time and for everything you do to champion original music in our region.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br><a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join('\n'),
  },
  {
    type: 'MidRangeCafeBar',
    subject: 'Performance Inquiry: Josh and Maria (Husband-Wife Acoustic Duo)',
    footerPhotoRef: FOOTER,
    active: true,
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>My name is Josh Sherman, and I perform with my wife Maria as the acoustic duo "Josh and Maria." We are a regional act based in Salem, VA, and we are currently booking our [Booking Period] run and would love to be considered for a slot at [Venue Name].</p>',
      '<p>We have [Target Dates] available. We\'ve been performing together for over 12 years, offering a tight, professional set that balances original singer-songwriter material with select covers. We pride ourselves on being reliable, easy to work with, and a great fit for rooms that appreciate harmony-driven Americana.</p>',
      '<p>Maria and I have been writing and performing together for over eleven years — the kind of close harmony that comes from a shared kitchen table — balancing our own songwriting with a careful selection of covers. We\'ve built a steady regional following with regular shows at Stave &amp; Cork in Salem; two summers running at the Pete Dye River Course clubhouse in Blacksburg; the Salem farmers market summer after summer; and repeat appearances at Music in the Park in Marion. We take care of our audience and the room.</p>',
      '<p>A few live samples from our repertoire:</p>',
      '<ul>',
      '  <li><a href="https://www.web-jam.com/music/songs?id=66a0ec5fd1005f8095f3cef3">Proud Mary (CCR) — live at Olde Salem Brewing</a></li>',
      '  <li><a href="https://www.web-jam.com/music/songs?id=6728e8bb25cc2073a9395c4e">Country Roads (John Denver) — live at Gusto\'s Pizza</a></li>',
      '  <li><a href="https://web-jam.com/music/songs?id=69fdcc4b586f5175c6db44a7">Dark Light (Original) — live at Salem Farmers Market</a></li>',
      '</ul>',
      '<p>Full music links and performance history available at <a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a>.</p>',
      '<p>Let me know if any of those dates work — happy to talk through details.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br><a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join('\n'),
  },
  {
    type: 'PubFestivalBrewery',
    subject: 'Performance Inquiry: Josh and Maria — Acoustic Duo for [Booking Period]',
    footerPhotoRef: FOOTER,
    active: true,
    bodyHtml: [
      '<p>Hi [Contact Name],</p>',
      '<p>My name is Josh Sherman — my wife and I play as Josh and Maria, a professional husband-wife acoustic duo based in Salem, VA. We still have a few [Booking Period] dates open and would love to bring our energetic acoustic set to [Venue Name].</p>',
      '<p>We have [Target Dates] available and are looking to book a 2-3 hour set. We\'ve spent over 12 years performing at festivals, breweries, and venues throughout Southwest Virginia, providing a versatile mix of original Americana and crowd-pleasing covers.</p>',
      '<p>Beyond the originals, we know how to read a room. We\'ve built our live set across the Roanoke Valley — regular shows at Stave &amp; Cork in Salem, two summers running at the Pete Dye River Course clubhouse in Blacksburg, the Salem farmers market summer after summer, and Music in the Park up in Marion — so we\'re equally comfortable filling a dance floor on a Saturday night and holding a quiet room at a Sunday brunch. We bring our own PA.</p>',
      '<p>A few live samples from our set:</p>',
      '<ul>',
      '  <li><a href="https://www.web-jam.com/music/songs?id=66a0ec5fd1005f8095f3cef3">Proud Mary (CCR) — live at Olde Salem Brewing</a></li>',
      '  <li><a href="https://web-jam.com/music/songs?id=69fdcd7a586f5175c6db44a9">I\'m Yours (Jason Mraz) — live at Salem Farmers Market</a></li>',
      '  <li><a href="https://www.web-jam.com/music/songs?id=6728e8bb25cc2073a9395c4e">Country Roads (John Denver) — live at Gusto\'s Pizza</a></li>',
      '  <li><a href="https://web-jam.com/music/songs?id=5f5e6b7d13772f0004a091ad">Misty Rainy Morning (Original)</a></li>',
      '</ul>',
      '<p>Our full performance history and music can be found at <a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a>.</p>',
      '<p>Let me know if any of those dates work — happy to talk through details.</p>',
      '<p>Best,<br>Josh &amp; Maria<br>540-494-8035<br><a href="https://www.joshandmariamusic.com">joshandmariamusic.com</a></p>',
    ].join('\n'),
  },
];

export async function seedTemplates(model: { findOneAndUpdate: (...args: unknown[]) => Promise<unknown> } = TemplateModel as never): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const t of TEMPLATES) {
    const doc = await model.findOneAndUpdate(
      { type: t.type },
      { ...t, lastModifiedBy: SEEDED_BY },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    results.push(doc);
  }
  return results;
}

/* istanbul ignore next */
async function run(): Promise<void> {
  await utils.mongoConnect(mongoose);
  const docs = await seedTemplates();
  console.log(`seeded/updated ${docs.length} templates`);
  await mongoose.connection.close();
}

/* istanbul ignore next */
if (process.argv[1] && process.argv[1].includes('seed-templates')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

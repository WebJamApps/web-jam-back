import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// The target weekend a touch relates to (#898/#923) — same shape as the
// outreach schema's targetWeekend, duplicated here (rather than shared) so the
// venue model has no import dependency on the outreach model. Optional: only
// send/outcome touches carry one; a plain visit/call/card touch does not.
const touchTargetWeekendSchema = new Schema({
  start: { type: Date, required: false },
  end: { type: Date, required: false },
}, { _id: false });

// Per-venue contact timeline (#898) — the backend of the JaMmusic outreach
// workspace's per-venue history view. Kept as a small embedded array (not its
// own collection like `outreach`, #823): a touch is a lightweight timeline
// entry, always read as part of "show me this venue's history," never queried
// across venues on its own.
//
// `type` covers both manual/offline contact (visit/form/card/call/gig/other)
// AND the two events the 2026-07-10 rescope (#898 comments) called out
// specifically:
//   - 'email': an outreach send (pitch or follow-up). Carries `templateType`
//     (which template rendered) + `targetWeekend` (which weekend the pitch was
//     for), so the UI can show "pitched for Sept 26" vs "pitched for Oct 10"
//     distinctly per the rescope's example.
//   - 'outcome': a recorded outcome (interested / not-interested / booked /
//     target-filled). Carries `outcome` (the recorded value), `targetWeekend`
//     (which pitch this outcome answers), and `bookedDate` when the outcome is
//     'booked' (the actual gig date, distinct from the weekend range pitched).
// `outreachId` links a touch back to the outreach record that generated it,
// when there is one (a manual 'visit'/'card' touch has none). `actor` is who
// or what recorded the touch (human name or agent identity, #818 convention).
//
// Written by POST /venue/:id/touch (manual touches) and by the outcome-
// recording endpoint (#898, outreach-controller.recordOutcome) for email-sent
// and outcome touches.
const touchSchema = new Schema({
  date: { type: Date, required: true, default: Date.now },
  type: {
    type: String,
    required: true,
    enum: ['visit', 'form', 'card', 'call', 'email', 'gig', 'other', 'outcome'],
  },
  note: { type: String, required: false, trim: true },
  templateType: { type: String, required: false, trim: true },
  targetWeekend: { type: touchTargetWeekendSchema, required: false },
  outcome: {
    type: String,
    required: false,
    enum: ['interested', 'not-interested', 'booked', 'target-filled'],
  },
  bookedDate: { type: Date, required: false },
  outreachId: { type: Schema.Types.ObjectId, ref: 'Outreach', required: false },
  actor: { type: String, required: false, trim: true },
}, { _id: false });

// Booking-outreach venues. As of web-jam-back#819 Mongo is the single master
// for venues (the Gig Booking Worksheet xlsx is retired). Unlike gigs — which
// live in WebJamSocketCluster's DB and are read via a dedicated connection —
// venues live in web-jam-back's OWN default database, so this model binds to the
// default mongoose connection like every other web-jam-back collection.
//
// `status` is lifecycle only: `archived` is the soft-delete state (DELETE never
// hard-removes a venue, so its history/outreach links survive a fat-fingered
// phone delete). Per-campaign outreach status lives in the separate `outreach`
// collection (#823), not here.
const venueSchema = new Schema({
  name: { type: String, required: true, trim: true },
  city: { type: String, required: false, trim: true },
  usState: { type: String, required: false, trim: true },
  venueType: {
    type: String,
    required: false,
    enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'],
  },
  contactName: { type: String, required: false, trim: true },
  email: {
    type: String, required: false, lowercase: true, trim: true,
  },
  phone: { type: String, required: false, trim: true },
  website: { type: String, required: false, trim: true },
  status: {
    type: String, required: false, enum: ['active', 'archived'], default: 'active',
  },
  // Outreach targeting gate (#843/#844). A venue is only ever selected as an
  // outreach target when it has been VETTED: `outreachEligible` true AND a
  // `venueType` set. Defaults to FALSE so no venue can be auto-pitched until a
  // human has explicitly tagged + enabled it ("approval required by default" at
  // the venue level — never auto-select an unvetted venue).
  outreachEligible: { type: Boolean, required: false, default: false },
  // Vetting/disqualification tags (#843) — the data a human uses to decide
  // outreachEligible, and that the selection logic (#844) checks. Derived from
  // the criteria review of the 5 mis-sent venues:
  // - inScope: is this a gig-booking venue at all? false = anthem/other (Salem
  //   Red Sox, ODAC Tournament) — never a target.
  // - bookingStatus: `booking` = open to booking; `not-booking` = closed / new
  //   management that stopped (Radford); `booked` = currently full (Olde Salem).
  // - interested: false = not worth pursuing (pay too low / declined — Harrisonburg).
  // - payTier: free-text pay note. lastVerified: when the info was last checked
  //   (stale venues get re-verified). contactVerified: is the contact confirmed
  //   correct (Olde Salem went to the wrong person).
  inScope: { type: Boolean, required: false, default: true },
  bookingStatus: {
    type: String, required: false, enum: ['booking', 'not-booking', 'booked'], default: 'booking',
  },
  interested: { type: Boolean, required: false, default: true },
  payTier: { type: String, required: false, trim: true },
  lastVerified: { type: Date, required: false },
  contactVerified: { type: Boolean, required: false, default: false },
  notes: { type: String, required: false },
  // Template-selection inputs (#848). `relationshipStage` overrides the
  // auto-derived cold/returning stage when set; left unset = auto-derive
  // (booked / prior replied-or-booked outreach => returning, else cold).
  // `templateOverride` forces a specific template type for special cases,
  // beating the venue's own venueType.
  relationshipStage: { type: String, required: false, enum: ['cold', 'returning'] },
  templateOverride: { type: String, required: false, enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'] },
  // Prospect-ranking inputs (#867) — surfaced in the AdminVenues "Prospect
  // Score" sort (JaMmusic#1139). All optional/soft; the score is computed
  // client-side so its weights stay tunable without a deploy.
  // - originalsFit: how much the venue welcomes ORIGINAL music (heaviest weight).
  // - travelBand: coarse distance band from Salem, VA (no geocoding) — farther =
  //   higher travel cost in the net-value calc.
  // - priority: manual 0-5 boost/override. (payTier above feeds pay value $/$$/$$$.)
  originalsFit: { type: String, required: false, enum: ['none', 'some', 'loves'] },
  travelBand: { type: String, required: false, enum: ['local', 'regional', 'far'] },
  priority: { type: Number, required: false, min: 0, max: 5 },
  lastContacted: { type: Date, required: false },
  // Global outcome standing (#923). `doNotContact` is set by a `not-interested`
  // outreach outcome — permanent, and excluded from /outreach/candidates
  // FOREVER (in addition to the outreachEligible gate); nothing in this repo
  // ever flips it back off automatically. `bookedDate` is the actual gig date
  // once a booking outcome is recorded (bookingStatus:'booked' above already
  // captures the coarse standing; this is the specific date). Both are written
  // by the outcome-recording endpoint (#898) — this issue only adds the fields.
  doNotContact: { type: Boolean, required: false, default: false },
  bookedDate: { type: Date, required: false },
  // Per-venue contact timeline (#898) — see touchSchema above.
  touches: { type: [touchSchema], required: false, default: [] },
  // The AI agent or human that last wrote this record (#818 `actor` field — one
  // shared agent identity authenticates, but each write records who acted).
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.Venue || mongoose.model('Venue', venueSchema);

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
  // #983 — street address, the disambiguator for same-name/same-city
  // locations (e.g. two Macado's in Roanoke). Schema stays required:false ON
  // PURPOSE (#987): a schema-level `required` would break every write to
  // every existing address-less record. `address` IS required on create,
  // and normalized on every write (USPS Pub 28 abbreviations) — both
  // enforced in the controller, not here. Never back-migrated onto existing
  // records (see #983/#987 non-goals) — it's filled/normalized the next time
  // a venue is created/edited. See venue-controller.ts's findDuplicate for
  // how this refines the POST /venue dedup match, and updateVenue for why a
  // once-set address can't be cleared via PUT.
  address: { type: String, required: false, trim: true },
  usState: { type: String, required: false, trim: true },
  // #972 — 2-letter country code (validated in venue-controller.ts), defaulting
  // to 'US' since every venue on record today is US-based. `region` is optional
  // free-text state/province for non-US venues; US venues keep using `usState`
  // as-is (no migration of existing records — they all default cleanly).
  country: {
    type: String, required: false, trim: true, uppercase: true, default: 'US',
  },
  region: { type: String, required: false, trim: true },
  venueType: {
    type: String,
    required: false,
    enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'],
  },
  contactName: { type: String, required: false, trim: true },
  // Primary/canonical booking contact address (#974). Existing records already
  // populate this — no data move on the #974 rename-in-place. Format is
  // validated in venue-controller.ts (EMAIL_RE, shared with secondaryEmail
  // below via src/lib/email.ts), same convention as before #974.
  email: {
    type: String, required: false, lowercase: true, trim: true,
  },
  // Second booking contact address (#974) — some venues have two contacts
  // (e.g. Slow Play Brewing: info@ + chelsea@). Optional; when present, every
  // outreach send (pitch/batch/follow-up) goes to BOTH `email` and
  // `secondaryEmail`, never secondaryEmail alone. Same format validation as
  // `email`.
  secondaryEmail: {
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
  // - bookingStatus: `booking` = open to booking; `not-booking` = closed / new
  //   management that stopped (Radford); `booked` = currently full (Olde Salem).
  // - interested: false = not worth pursuing (pay too low / declined — Harrisonburg).
  // - payTier: free-text pay note. lastVerified: when the info was last checked
  //   (stale venues get re-verified; its own fate is still open, unresolved by
  //   #974).
  //
  // `contactVerified` (was: has a human confirmed this contact is correct?)
  // was dropped (#974, 2026-07-18) — a valid, present primary `email` IS the
  // verification now (see the #974 sendability guard in outreach-controller.ts),
  // so the separate manual flag was redundant. See migrate-drop-contact-
  // verified.ts for the one-time backfill.
  //
  // `inScope` (was: is this a gig-booking venue at all?) was dropped (#954,
  // 2026-07-16) — it read as a duplicate of `outreachEligible` and Josh only
  // ever used Eligible. A venue that was `inScope: false` is permanently
  // excluded via `outreachEligible: false` instead (the sole stop/go gate as
  // of #980, below) — see migrate-drop-in-scope.ts for the one-time backfill.
  //
  // #980 (2026-07-18) — `bookingStatus` is now a DERIVED, READ-ONLY field:
  // booked (has an upcoming linked gig) / not-booking (an active
  // `resumeBooking` cooldown) / booking (otherwise) — computed fresh on every
  // read (venue-controller.ts's attachGigLinks/computeBookingStatus), never
  // hand-set. The stored field below is kept only so existing documents don't
  // need a migration; the app never writes it anymore and every API response
  // overwrites it with the computed value before the client ever sees it.
  bookingStatus: {
    type: String, required: false, enum: ['booking', 'not-booking', 'booked'], default: 'booking',
  },
  interested: { type: Boolean, required: false, default: true },
  payTier: { type: String, required: false, trim: true },
  lastVerified: { type: Date, required: false },
  // #980 — minimum spacing (in months) Josh wants between gigs at this venue
  // before it's offered as a candidate again for a new target window W (the
  // gigInterval-aware generalization of the old #958 "never re-pitch an
  // already-booked venue" safety net — see excludeUpcomingGigVenues in
  // outreach-controller.ts). 0 (the default — every existing venue defaults
  // here) turns the check off entirely: BY DESIGN this removes the old
  // blanket "any upcoming linked gig excludes the venue forever" rule (the
  // "repeat-venue trap" #980 was written to fix), so nothing changes for a
  // venue until Josh explicitly opts it into spacing by setting this > 0.
  gigInterval: {
    type: Number, required: false, default: 0, min: 0,
  },
  // #980 — a manual "don't pitch until this date" cooldown, for soft-nos /
  // deliberate holds (e.g. "nice, but not booking right now — try again in
  // ~4 months"). Unset, or a date already in the past, means no active
  // cooldown. Drives both the getCandidates exclusion (outreach-
  // controller.ts) and the derived bookingStatus:'not-booking' readout above.
  resumeBooking: { type: Date, required: false },
  // #995 — a SEPARATE "calendar full through" fact, split out from
  // resumeBooking: `resumeBooking` means "don't contact until" (the venue
  // asked for space, compared against TODAY — e.g. Mama Jean's "try again in
  // 4 months"); `bookedThrough` means "their dates are gone, but contacting
  // them now is fine" (compared against the TARGET WINDOW being pitched, not
  // today — e.g. Olde Salem Brewing is booked solid through 2026 but still
  // pitchable NOW for a January 2027 weekend). Conflating the two into one
  // date lost information Josh can't reconstruct from memory later, hence the
  // split. Optional; unset behaves identically to today on both the
  // getCandidates exclusion (outreach-controller.ts) and the derived
  // bookingStatus readout above.
  bookedThrough: { type: Date, required: false },
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
  // #980 (2026-07-18) — `doNotContact` (#923's permanent global outcome
  // standing, set by a `not-interested` outreach outcome) is DELETED: folded
  // into `outreachEligible`, which is now the SOLE permanent stop/go gate (a
  // `not-interested` outcome sets `outreachEligible=false` instead — see
  // outreach-controller.ts's applyOutcomeSideEffects). Any venue that still
  // has `doNotContact:true` in storage is backfilled by the one-time
  // migrate-drop-do-not-contact.ts script (outreachEligible=false + a dated
  // note recording the prior exclusion, then $unset doNotContact) — Josh runs
  // that manually post-merge, same flow as #954/#974.
  //
  // `bookedDate` is the actual gig date once a `booked` outreach outcome is
  // recorded — kept as-is (unrelated to the now-derived `bookingStatus`
  // above, which only reflects actual linked-gig data, not this outcome log).
  bookedDate: { type: Date, required: false },
  // Per-venue contact timeline (#898) — see touchSchema above.
  touches: { type: [touchSchema], required: false, default: [] },
  // The AI agent or human that last wrote this record (#818 `actor` field — one
  // shared agent identity authenticates, but each write records who acted).
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.Venue || mongoose.model('Venue', venueSchema);

import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Outreach log (web-jam-back#823) — one record per pitch sent to a venue. Kept
// in its OWN collection rather than embedded on the venue (decided 2026-06-19):
// a venue can be pitched for several gig windows over time, each its own touch
// history. `venueId` references the Venue; `templateUsed` is the template `type`
// rendered; `targetDates` is the gig window pitched (free text, e.g.
// "Fri Aug 14 – Sun Aug 16"). `status` is the campaign lifecycle.
//
// `messageId` is the RFC Message-ID Gmail assigned the send; `gmailThreadId` is
// the Gmail thread, backfilled later by the reply-detection job (#825/#100) —
// nodemailer's SMTP send returns the Message-ID, not the thread id. `followUps`
// records each later touch in this same campaign (cadence engine, #824).
// One later touch in the campaign. `type` distinguishes an email follow-up from
// a CALL touch (#825); a call has no messageId — `eventId` holds the Google
// Calendar event created for the call task instead.
const followUpSchema = new Schema({
  sentAt: { type: Date, required: false },
  type: { type: String, required: false, enum: ['email', 'call'], default: 'email' },
  messageId: { type: String, required: false },
  eventId: { type: String, required: false },
  step: { type: Number, required: false },
}, { _id: false });

// AI reply-classification (#825 Half B). When the reply-detection job matches a
// venue's reply, Claude Haiku reads it and SUGGESTS a venue update here. The
// suggestion is advisory only — it is surfaced in the AdminVenues "replies to
// review" queue and NOTHING is written to the venue until Josh approves
// (apply-suggestion). `reviewed` flips true once he approves/edits/dismisses, so
// the suggestion drops out of the pending queue. `model` records which model
// produced it. AI never auto-writes booking data (mis-send incident guardrail).
const suggestionSchema = new Schema({
  sentiment: { type: String, required: false, enum: ['positive', 'negative', 'needs-info'] },
  proposedBookingStatus: { type: String, required: false, enum: ['booking', 'not-booking', 'booked'] },
  proposedInterested: { type: Boolean, required: false },
  rationale: { type: String, required: false },
  model: { type: String, required: false },
  reviewed: { type: Boolean, required: false, default: false },
}, { _id: false });

const outreachSchema = new Schema({
  venueId: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
  templateUsed: { type: String, required: false, trim: true },
  targetDates: { type: String, required: false, trim: true },
  // The booking window pitched (e.g. "August"); stored on the sent record so the
  // copy and any cadence follow-ups stay consistent with what went out.
  bookingPeriod: { type: String, required: false, trim: true },
  sentAt: { type: Date, required: false, default: Date.now },
  // Campaign lifecycle. #844 reworked outreach to BATCH target-list approval —
  // the approval gate is the venue selection, not a per-email draft — so the
  // `draft`/`rejected` states are gone. A record exists only once an email has
  // actually gone out (`sent`), then advances via replies/cadence.
  status: {
    type: String,
    required: false,
    enum: ['sent', 'replied', 'declined', 'booked', 'no-response'],
    default: 'sent',
  },
  messageId: { type: String, required: false, trim: true },
  gmailThreadId: { type: String, required: false, trim: true },
  // Reply-detection (#825 Half B). When the IMAP job matches a venue's reply to
  // this pitch's `messageId`, the record is moved to `replied` (which halts the
  // cadence) and these capture when + a short text snippet of the reply. The
  // `suggestion` holds Claude Haiku's advisory classification (human-approved
  // before any venue write).
  repliedAt: { type: Date, required: false, default: null },
  replySnippet: { type: String, required: false, trim: true },
  suggestion: { type: suggestionSchema, required: false, default: null },
  // #825 bounce auto-flag. Set to 'bounce' when the "reply" the IMAP job matched
  // was actually a delivery-failure bounce (mailer-daemon/DSN), not a genuine
  // venue reply. Distinguishes a bounced record (status already halted to
  // `no-response`, deterministic, no AI suggestion) from a real replied record
  // in the /outreach/replies-pending queue, so the JaMmusic UI (#1162) can render
  // it as "bounced — needs new email".
  replyKind: { type: String, required: false, enum: ['bounce'], default: null },
  // Which AI agent or human sent this pitch (#818 `actor` field).
  sentBy: { type: String, required: false, trim: true },
  followUps: { type: [followUpSchema], required: false, default: [] },
  // Cadence engine (#824/#825). `step` is the touch number already completed
  // (1 = the pitch). `nextTouchDue` is when the next touch (email or call) is
  // due; the advance endpoint actions everything due and bumps these. Null
  // nextTouchDue = no more touches scheduled (sequence finished or halted).
  step: { type: Number, required: false, default: 1 },
  nextTouchDue: { type: Date, required: false, default: null },
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.Outreach || mongoose.model('Outreach', outreachSchema);

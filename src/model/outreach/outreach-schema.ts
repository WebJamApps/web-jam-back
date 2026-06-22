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
const followUpSchema = new Schema({
  sentAt: { type: Date, required: false },
  messageId: { type: String, required: false },
  step: { type: Number, required: false },
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
  // Which AI agent or human sent this pitch (#818 `actor` field).
  sentBy: { type: String, required: false, trim: true },
  followUps: { type: [followUpSchema], required: false, default: [] },
  // Cadence engine (#824). `step` is the touch number already sent (1 = the
  // pitch). `nextTouchDue` is when the next email follow-up should go out; the
  // advance endpoint sends everything due and bumps these. Null nextTouchDue =
  // no more touches scheduled (sequence finished or halted). Call touches
  // (days 7/18) are added with the Google Calendar work (#825).
  step: { type: Number, required: false, default: 1 },
  nextTouchDue: { type: Date, required: false, default: null },
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.Outreach || mongoose.model('Outreach', outreachSchema);

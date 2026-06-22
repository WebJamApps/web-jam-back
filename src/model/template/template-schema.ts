import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Pitch-email templates (web-jam-back#822). Mongo is the single master; Phase 1
// is an API for AI agents (Phase 2 = editing UI, JaMmusic#1116). One template
// per venue type + the Online Form Information Block. `bodyHtml` carries the
// personalization tokens [Contact Name] / [Venue Name] / [Booking Period] /
// [Target Dates], filled in at send time (#823). `footerPhotoRef` is a KEY into
// the repo-bundled email assets (resolved to an inline-CID image at send), not a
// URL. `type` is unique — one template per type.
const templateSchema = new Schema({
  type: {
    type: String,
    required: true,
    enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar', 'OnlineForm'],
  },
  // Relationship stage (#848): `cold` = first contact, `returning` = "we've
  // played here, would love to come back". A template is now keyed by type +
  // stage, so each venue type can have a different cold vs. returning pitch.
  // Existing single-per-type templates default to `cold`.
  stage: {
    type: String,
    required: false,
    enum: ['cold', 'returning'],
    default: 'cold',
  },
  subject: { type: String, required: false, trim: true },
  bodyHtml: { type: String, required: false },
  footerPhotoRef: { type: String, required: false, trim: true },
  active: { type: Boolean, required: false, default: true },
  // The AI agent or human that last wrote this record (#818 `actor` field).
  lastModifiedBy: { type: String, required: false },
}, options);

// One template per (type, stage) — replaces the old `type`-unique constraint (#848).
templateSchema.index({ type: 1, stage: 1 }, { unique: true });

export default mongoose.models.Template || mongoose.model('Template', templateSchema);

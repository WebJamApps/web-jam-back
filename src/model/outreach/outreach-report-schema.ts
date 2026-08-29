import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Outreach run reports (web-jam-back#1052).
// Stores rendered HTML review artifacts and metadata for target weekend campaigns
// (e.g. `2026-10-16-to-2026-10-18`) so they can be served dynamically via
// GET /outreach/report/:weekend without server redeploys, and deleted upon booking.
const outreachReportSchema = new Schema({
  weekend: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  htmlContent: {
    type: String,
    required: true,
  },
  candidatesCount: {
    type: Number,
    required: false,
    default: 0,
  },
  dispatchedCount: {
    type: Number,
    required: false,
    default: 0,
  },
  metadata: {
    type: Schema.Types.Mixed,
    required: false,
    default: () => ({}),
  },
}, options);

export default mongoose.models.OutreachReport || mongoose.model('OutreachReport', outreachReportSchema);

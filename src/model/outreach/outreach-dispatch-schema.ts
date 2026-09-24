import mongoose from 'mongoose';
import { targetWeekendSchema } from './approval-schema-base.js';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Dispatch record for chunked / time-limited batch outreach dispatches (web-jam-back#1120, D-74, D-75, D-76).
// Stores the vetted venue set checked at preflight, tied to the two approval records
// (Gate 1 venue-set & Gate 2 draft fingerprints) as they stood at check time.
const outreachDispatchSchema = new Schema({
  dispatchId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  batchId: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  weekend: {
    type: String,
    required: false,
    index: true,
    trim: true,
  },
  targetWeekend: {
    type: targetWeekendSchema,
    required: false,
  },
  targetDates: {
    type: String,
    required: false,
    trim: true,
  },
  templateType: {
    type: String,
    required: false,
    trim: true,
  },
  bookingPeriod: {
    type: String,
    required: false,
    trim: true,
  },
  customIntro: {
    type: String,
    required: false,
    trim: true,
  },
  customBody: {
    type: String,
    required: false,
    trim: true,
  },
  cc: {
    type: Schema.Types.Mixed,
    required: false,
  },
  venueIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Venue',
    required: true,
  }],
  venueCount: {
    type: Number,
    required: true,
  },
  attemptedVenueIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Venue',
  }],
  venueApprovalId: {
    type: Schema.Types.ObjectId,
    ref: 'OutreachVenueApproval',
    required: false,
  },
  draftApprovalId: {
    type: Schema.Types.ObjectId,
    ref: 'OutreachDraftApproval',
    required: false,
  },
  venueApprovalUpdatedAt: {
    type: Date,
    required: false,
  },
  draftApprovalUpdatedAt: {
    type: Date,
    required: false,
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'aborted'],
    default: 'pending',
  },
  createdBy: {
    type: String,
    required: false,
    trim: true,
  },
}, options);

export default mongoose.models.OutreachDispatch
  || mongoose.model('OutreachDispatch', outreachDispatchSchema);

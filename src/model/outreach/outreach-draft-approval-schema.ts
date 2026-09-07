import mongoose from 'mongoose';
import { baseApprovalFields } from './approval-schema-base.js';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

const draftFingerprintItemSchema = new Schema({
  venueId: {
    type: Schema.Types.ObjectId,
    ref: 'Venue',
    required: true,
  },
  fingerprint: {
    type: String,
    required: true,
    trim: true,
  },
  subject: {
    type: String,
    required: false,
    trim: true,
  },
}, { _id: false });

// Gate 2: Draft copy approval / per-email draft fingerprints (web-jam-back#1078, D-39, D-40, D-41).
// Records server-side explicit approval of the full rendered draft copy for each venue in a batch,
// captured as content fingerprints of each approved email.
const outreachDraftApprovalSchema = new Schema({
  ...baseApprovalFields,
  draftFingerprints: {
    type: [draftFingerprintItemSchema],
    required: true,
    validate: {
      validator: (arr: unknown[]) => Array.isArray(arr) && arr.length > 0,
      message: 'draftFingerprints must contain at least one item',
    },
  },
}, options);

export default mongoose.models.OutreachDraftApproval
  || mongoose.model('OutreachDraftApproval', outreachDraftApprovalSchema);

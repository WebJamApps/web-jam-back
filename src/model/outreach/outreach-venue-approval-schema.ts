import mongoose from 'mongoose';
import { approvalTimeField, baseApprovalFields } from './approval-schema-base.js';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Gate 1: Target venue-set approval (web-jam-back#1078, D-39, D-40, D-41).
// Records server-side explicit approval of the target venue set for a batch
// before any draft copy is reviewed or dispatched.
const outreachVenueApprovalSchema = new Schema({
  ...baseApprovalFields,
  venueIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Venue',
    required: true,
  }],
  // Absence on a legacy record must not renew every venue on a later widening.
  venueApprovals: {
    type: [new Schema({
      venueId: { type: Schema.Types.ObjectId, ref: 'Venue', required: true },
      approvedAt: approvalTimeField,
    }, { _id: false })],
    default: undefined,
  },
}, options);

export default mongoose.models.OutreachVenueApproval
  || mongoose.model('OutreachVenueApproval', outreachVenueApprovalSchema);

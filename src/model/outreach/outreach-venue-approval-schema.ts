import mongoose from 'mongoose';
import { baseApprovalFields } from './approval-schema-base.js';

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
}, options);

export default mongoose.models.OutreachVenueApproval
  || mongoose.model('OutreachVenueApproval', outreachVenueApprovalSchema);

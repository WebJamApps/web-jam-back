import mongoose from 'mongoose';

const { Schema } = mongoose;

export const targetWeekendSchema = new Schema({
  start: { type: Date, required: false },
  end: { type: Date, required: false },
}, { _id: false });

export const baseApprovalFields = {
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
  approver: {
    type: String,
    required: true,
    trim: true,
  },
  approvedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  notes: {
    type: String,
    required: false,
    trim: true,
  },
  metadata: {
    type: Schema.Types.Mixed,
    required: false,
    default: () => ({}),
  },
};

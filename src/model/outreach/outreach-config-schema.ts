import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Singleton config for the outreach batch flow (#844). One document, identified
// by `key: 'outreach'`. `autoApprove`: when true, an agent holding
// outreach:create may send a batch WITHOUT a human outreach:approve — used once
// Josh trusts the venue tagging. Default false: every batch requires human
// approval until that trust is established (the post-incident safe default).
const outreachConfigSchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'outreach' },
  autoApprove: { type: Boolean, required: false, default: false },
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.OutreachConfig || mongoose.model('OutreachConfig', outreachConfigSchema);

import mongoose from 'mongoose';

const { Schema } = mongoose;

// Fan distribution list for gig promotion (email now; SMS fields are present but
// inert until the SMS sprint). `status` drives who a send reaches: only `active`
// subscribers are emailed. Self-unsubscribe (token link) and admin removal both
// land on `unsubscribed`.
const subscriberSchema = new Schema({
  name: { type: String, required: true },
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true,
  },
  phone: { type: Number, required: false },
  channels: {
    email: { type: Boolean, required: false, default: true },
    sms: { type: Boolean, required: false, default: false },
  },
  status: {
    type: String, required: false, enum: ['pending', 'active', 'unsubscribed'], default: 'pending',
  },
  // Single-use token emailed for double opt-in confirmation; cleared on confirm.
  confirmToken: { type: String, required: false, default: '' },
  // Stable per-subscriber token embedded in every send's unsubscribe link.
  unsubscribeToken: { type: String, required: false, default: '' },
  // Inert until SMS sprint; records TCPA opt-in consent.
  consent: {
    sms: {
      agreed: { type: Boolean, required: false },
      at: { type: Date, required: false },
      ip: { type: String, required: false },
    },
  },
  createdAt: { type: Date, required: false, default: Date.now },
});

export default mongoose.models.Subscriber || mongoose.model('Subscriber', subscriberSchema);

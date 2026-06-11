import mongoose from 'mongoose';

const { Schema } = mongoose;

// Single-document store for the CollegeLutheran Facebook Page access token
// (CollegeLutheran#740 / web-jam-back#797). The token is a never-expiring page
// token; it is written only by the admin "Reconnect Facebook" flow (PUT
// /facebook/token) and read by the hourly feed-cache refresher. Keyed by a
// constant `key` so upsert always targets the same row.
const facebookTokenSchema = new Schema({
  key: {
    type: String, required: true, unique: true, default: 'pageToken',
  },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.FacebookToken || mongoose.model('FacebookToken', facebookTokenSchema);

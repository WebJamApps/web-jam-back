import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per Facebook Page access token, keyed by `pageId`
// (web-jam-back#797 single-page → #799 multi-page: CollegeLutheran + WebJamLLC,
// same Meta app). Each token is a never-expiring page token; it is written only
// by the admin "Reconnect Facebook" flow (PUT /facebook/token, carrying its
// pageId) and read by the hourly feed-cache refresher. The legacy single-page
// doc (key `pageToken`) is migrated to the CLC pageId on startup — see
// migrateLegacyToken in FacebookController.ts.
const facebookTokenSchema = new Schema({
  pageId: {
    type: String, required: true, unique: true,
  },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.FacebookToken || mongoose.model('FacebookToken', facebookTokenSchema);

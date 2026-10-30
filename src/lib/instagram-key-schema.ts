import mongoose from 'mongoose';

export interface InstagramKey {
  userId: string;
  accessToken: string;
  issuedAt: Date;
}

// A fixed primary key makes concurrent first-use seeding insert only one record.
const schema = new mongoose.Schema<InstagramKey & { _id: string }>({
  _id: { type: String, default: 'instagram' },
  userId: { type: String, required: true },
  accessToken: { type: String, required: true, select: false },
  issuedAt: { type: Date, required: true },
}, { versionKey: false });

export default mongoose.model<InstagramKey & { _id: string }>('InstagramKey', schema);

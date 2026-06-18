import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Mirror of the gig schema owned by WebJamSocketCluster (it writes the data).
// web-jam-back only reads from the same Mongo `gigs` collection — keep the
// shape and explicit collection name in sync with that repo.
const gigSchema = new Schema({
  date: { type: String, required: false },
  time: { type: String, required: false },
  datetime: { type: Date, required: false },
  location: { type: String, required: false },
  city: { type: String, required: false },
  usState: { type: String, required: false },
  venue: { type: String, required: true },
  tickets: { type: String, required: false },
  duration: { type: Number, required: false, default: 0 },
  promoImageUrl: { type: String, required: false },
  more: { type: String, required: false },
}, options);

export default mongoose.models.Gig || mongoose.model('Gig', gigSchema, 'gigs');

import mongoose from 'mongoose';

const { Schema } = mongoose;

// Catalog details remain optional until verified from the rights sources. In
// particular, neither a performer credit nor legacy composer text supplies shares.
const writerSchema = new Schema({
  name: { type: String, required: true },
  share: { type: Number, min: 0, max: 100 },
}, { _id: false });

const recordingSchema = new Schema({
  isrc: String,
  release: String,
  artist: String,
  url: String,
  year: Number,
}, { _id: false });

const songSchema = new Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  composer: { type: String, required: false },
  category: { type: String, required: true, enum: ['original', 'pub', 'mission'] },
  album: { type: String, required: false },
  year: { type: Number, required: false },
  // Sparse uniqueness allows multiple songs which have not been recorded yet.
  // The migration adjusts the pre-existing non-sparse database index explicitly.
  url: { type: String, unique: true, sparse: true },
  image: { type: String, required: false },
  orderBy: { type: Number, required: false },
  writers: { type: [writerSchema], default: [] },
  bmiWorkNumber: String,
  iswc: String,
  copyrightRegistration: String,
  recordings: { type: [recordingSchema], default: [] },
}, { autoIndex: false }); // Index transition belongs to the staged migration, not app startup.

export default mongoose.models.Song || mongoose.model('Song', songSchema);

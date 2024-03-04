import mongoose from 'mongoose';

const { Schema } = mongoose;

const songSchema = new Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  composer: { type: String, required: false },
  category: { type: String, required: true, enum: ['original', 'pub', 'mission'] },
  album: { type: String, required: false },
  year: { type: Number, required: false },
  url: { type: String, required: true, unique: true },
  image: { type: String, required: false },
  orderBy: { type: Number, required: false },
});

export default mongoose.model('Song', songSchema);

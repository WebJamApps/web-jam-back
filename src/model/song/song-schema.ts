import mongoose from 'mongoose';

const { Schema } = mongoose;

const songSchema = new Schema({
  title: { type: String, required: true },
  url: { type: String, required: true, unique: true },
  category: { type: String, required: true, enum: ['original', 'pub', 'mission'] },
  author: { type: String, required: true },
  performer: { type: String, required: true },
});

export default mongoose.model('Song', songSchema);

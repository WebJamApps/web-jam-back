import mongoose from 'mongoose';

const { Schema } = mongoose;

// An ordered item in a setlist. Either REFERENCES an existing Song via songId
// (source of truth — title/artist/link are resolved from the Song at read
// time, never duplicated here) or carries its own inline title/artist/playLink
// for a cover that isn't catalogued — web-jam-back#937, hybrid fix #946.
const setlistItemSchema = new Schema({
  order: { type: Number, required: true },
  songId: { type: Schema.Types.ObjectId, ref: 'Song', required: false },
  // Required only for uncatalogued items — when songId is set, title/artist/
  // playLink are derived from the referenced Song (see setlist-resolve.ts) and
  // must not be relied on or required here.
  title: {
    type: String,
    required: [
      function requiredWhenNoSongId(this: { songId?: unknown }): boolean { return !this.songId; },
      'title is required when songId is not set',
    ],
  },
  artist: { type: String, required: false },
  playLink: { type: String, required: false },
  notes: { type: String, required: false },
});

const setlistSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, required: false },
  items: { type: [setlistItemSchema], default: [] },
});

export default mongoose.models.Setlist || mongoose.model('Setlist', setlistSchema);

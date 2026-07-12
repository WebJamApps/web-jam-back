import mongoose from 'mongoose';

const { Schema } = mongoose;

// An ordered item in a setlist. Either references an existing Song (reusing its
// link/metadata) or carries its own inline title + play link for covers that
// aren't catalogued — web-jam-back#937.
const setlistItemSchema = new Schema({
  order: { type: Number, required: true },
  songId: { type: Schema.Types.ObjectId, ref: 'Song', required: false },
  title: { type: String, required: true },
  playLink: { type: String, required: false },
  notes: { type: String, required: false },
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Effective title is always the denormalized copy on the item (seeded from the
// referenced Song at create time) so listing never needs a join.
setlistItemSchema.virtual('effectiveTitle').get(function effectiveTitle(this: { title: string }): string {
  return this.title;
});

// Effective play link = the item's own playLink when set, else the referenced
// Song's url (resolvable only when songId is populated). Neither present →
// undefined, which is a valid item (e.g. a song still being learned).
setlistItemSchema.virtual('effectivePlayLink').get(function effectivePlayLink(this: {
  playLink?: string; songId?: unknown;
}): string | undefined {
  if (this.playLink) return this.playLink;
  const song = this.songId as { url?: string } | null | undefined;
  if (song && typeof song === 'object' && typeof song.url === 'string') return song.url;
  return undefined;
});

const setlistSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, required: false },
  items: { type: [setlistItemSchema], default: [] },
}, { toJSON: { virtuals: true }, toObject: { virtuals: true } });

export default mongoose.models.Setlist || mongoose.model('Setlist', setlistSchema);

import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Gigs used to live in WebJamSocketCluster's own Mongo, read here via a
// dedicated mirror connection (GIGS_MONGO_DB_URI, web-jam-back#814). As of
// web-jam-back#897 that data has been migrated into web-jam-data (this app's
// own default database, artist-scoped per #885) and the mirror connection is
// retired — gigs are now just another collection on the default mongoose
// connection, like every other model.
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
  // Artist/tenant slug (#885). Absent on all pre-#885 records, which read as
  // the default (JaMmusic) artist.
  artist: { type: String, required: false },
  // Venue linkage (#958). Optional: resolution everywhere is venueId FIRST,
  // else an EXACT normalized-name match against venue.name (never fuzzy) — see
  // src/lib/gig-venue-link.ts, the single shared implementation of that rule.
  // Backfilled onto existing gigs by the idempotent, dry-run-default migration
  // at src/scripts/migrate-gig-venue-id.ts; new gigs may set it directly.
  venueId: {
    type: Schema.Types.ObjectId, ref: 'Venue', required: false,
  },
}, options);

export default mongoose.models.Gig || mongoose.model('Gig', gigSchema, 'gigs');

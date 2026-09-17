import mongoose from 'mongoose';

const { Schema } = mongoose;

const publicationSchema = new Schema({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  api: { type: String, required: false, trim: true },
  type: { type: String, required: false, trim: true },
}, { _id: false });

// Venue-mining metro sweep history (web-jam-back#1106).
// Stores completed metro sweeps and publication metadata from `/venue-mining`.
// A unique index on `metroSlug` + `sweptAt` prevents duplicate records.
const venueMiningSweepSchema = new Schema({
  metroSlug: {
    type: String,
    required: true,
    trim: true,
  },
  sweptAt: {
    type: Date,
    required: true,
  },
  publication: {
    type: publicationSchema,
    required: true,
  },
  coverageArea: {
    type: [String],
    required: false,
    default: undefined,
  },
  excludeKeywords: {
    type: [String],
    required: false,
    default: undefined,
  },
  venuesCreatedCount: {
    type: Number,
    required: true,
    min: 0,
  },
  notes: {
    type: String,
    required: false,
    trim: true,
  },
  createdAt: {
    type: Date,
    required: false,
    default: Date.now,
  },
});

venueMiningSweepSchema.index({ metroSlug: 1, sweptAt: 1 }, { unique: true });

export default mongoose.models.VenueMiningSweep
  || mongoose.model('VenueMiningSweep', venueMiningSweepSchema, 'venue-mining-sweep');

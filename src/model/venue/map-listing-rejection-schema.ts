import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MAP_LISTING_REJECTION_COLLECTION = 'mapListingRejection' as const;

export interface MapListingRejectionRecord {
  listingId: string;
  name: string;
  rejectedBy: string;
  rejectedAt: Date;
}

// Persistent record of map listings Josh rejected on Find New Venues
// (web-jam-back#1215). Stored apart from `mapListing` so rejections survive
// the monthly Overture refresh, and included in daily backups and copy-to-dev.
const mapListingRejectionSchema = new Schema({
  listingId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  rejectedBy: {
    type: String,
    required: true,
    trim: true,
  },
  rejectedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: MAP_LISTING_REJECTION_COLLECTION,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

export default mongoose.models.MapListingRejection
  || mongoose.model('MapListingRejection', mapListingRejectionSchema, MAP_LISTING_REJECTION_COLLECTION);

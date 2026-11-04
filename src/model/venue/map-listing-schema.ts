import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MAP_LISTING_COLLECTION = 'mapListing' as const;

export const DISCOVER_LISTING_KINDS = [
  'bar',
  'lounge',
  'alcoholic_beverage_venue',
  'nightlife_venue',
  'dance_club',
  'music_venue',
  'brewery',
  'winery',
  'distillery',
] as const;

export const MAP_LISTING_KINDS = [
  ...DISCOVER_LISTING_KINDS,
  'restaurant',
  'casual_eatery',
  'cafe',
  'coffee_shop',
  'performing_arts_venue',
  'theatre_venue',
  'comedy_club',
  'event_venue',
  'festival_venue',
  'event_or_party_service',
  'social_club',
  'farmers_market',
  'farm',
  'inn',
  'hotel',
  'park',
  'golf_course',
  'country_club',
  'historic_site',
  'arcade',
] as const;

export type DiscoverListingKind = (typeof DISCOVER_LISTING_KINDS)[number];
export type MapListingKind = (typeof MAP_LISTING_KINDS)[number];

export interface MapListingPoint {
  type: 'Point';
  coordinates: [number, number];
}

export interface MapListingRecord {
  listingId: string;
  name: string;
  street: string;
  city?: string;
  state?: string;
  zipCode?: string;
  website?: string;
  email?: string;
  phone?: string;
  kind: MapListingKind;
  location: MapListingPoint;
  release: string;
  downloadedAt: Date;
}

const mapListingPointSchema = new Schema({
  type: { type: String, required: true, enum: ['Point'] },
  coordinates: {
    type: [Number],
    required: true,
    default: undefined,
    validate: {
      validator: (coords: unknown): boolean => (
        Array.isArray(coords)
        && coords.length === 2
        && typeof coords[0] === 'number'
        && Number.isFinite(coords[0])
        && Math.abs(coords[0]) <= 180
        && typeof coords[1] === 'number'
        && Number.isFinite(coords[1])
        && Math.abs(coords[1]) <= 90
      ),
      message: 'location.coordinates must be a valid [longitude, latitude] pair',
    },
  },
}, { _id: false });

// Monthly copy of open business listings within 200 miles of Salem VA from the
// Overture Maps Foundation (web-jam-back#1214). Kept in its own `mapListing`
// collection, skipped by daily backup exports and copy-to-dev, and refreshed
// by `.github/workflows/refresh-map-listings.yml`. A listing with no street is
// never kept.
const mapListingSchema = new Schema({
  listingId: {
    type: String, required: true, unique: true, trim: true,
  },
  name: { type: String, required: true, trim: true },
  street: { type: String, required: true, trim: true },
  city: { type: String, required: false, trim: true },
  state: { type: String, required: false, trim: true },
  zipCode: { type: String, required: false, trim: true },
  website: { type: String, required: false, trim: true },
  email: {
    type: String, required: false, lowercase: true, trim: true,
  },
  phone: { type: String, required: false, trim: true },
  kind: { type: String, required: true, enum: MAP_LISTING_KINDS },
  location: { type: mapListingPointSchema, required: true },
  release: { type: String, required: true, trim: true },
  downloadedAt: { type: Date, required: true },
}, {
  collection: MAP_LISTING_COLLECTION,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

mapListingSchema.index({ location: '2dsphere' });
mapListingSchema.index({ kind: 1 });
mapListingSchema.index({ name: 1, city: 1 });

export default mongoose.models.MapListing
  || mongoose.model('MapListing', mapListingSchema, MAP_LISTING_COLLECTION);

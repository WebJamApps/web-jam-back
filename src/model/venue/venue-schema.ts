import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Booking-outreach venues. As of web-jam-back#819 Mongo is the single master
// for venues (the Gig Booking Worksheet xlsx is retired). Unlike gigs — which
// live in WebJamSocketCluster's DB and are read via a dedicated connection —
// venues live in web-jam-back's OWN default database, so this model binds to the
// default mongoose connection like every other web-jam-back collection.
//
// `status` is lifecycle only: `archived` is the soft-delete state (DELETE never
// hard-removes a venue, so its history/outreach links survive a fat-fingered
// phone delete). Per-campaign outreach status lives in the separate `outreach`
// collection (#823), not here.
const venueSchema = new Schema({
  name: { type: String, required: true, trim: true },
  city: { type: String, required: false, trim: true },
  usState: { type: String, required: false, trim: true },
  venueType: {
    type: String,
    required: false,
    enum: ['Originals', 'PubFestivalBrewery', 'MidRangeCafeBar'],
  },
  contactName: { type: String, required: false, trim: true },
  email: {
    type: String, required: false, lowercase: true, trim: true,
  },
  phone: { type: String, required: false, trim: true },
  website: { type: String, required: false, trim: true },
  status: {
    type: String, required: false, enum: ['active', 'archived'], default: 'active',
  },
  // Outreach targeting gate (#843/#844). A venue is only ever selected as an
  // outreach target when it has been VETTED: `outreachEligible` true AND a
  // `venueType` set. Defaults to FALSE so no venue can be auto-pitched until a
  // human has explicitly tagged + enabled it ("approval required by default" at
  // the venue level — never auto-select an unvetted venue).
  outreachEligible: { type: Boolean, required: false, default: false },
  notes: { type: String, required: false },
  lastContacted: { type: Date, required: false },
  // The AI agent or human that last wrote this record (#818 `actor` field — one
  // shared agent identity authenticates, but each write records who acted).
  lastModifiedBy: { type: String, required: false },
}, options);

export default mongoose.models.Venue || mongoose.model('Venue', venueSchema);

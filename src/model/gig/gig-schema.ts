import mongoose from 'mongoose';

const { Schema } = mongoose;

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

// Mirror of the gig schema owned by WebJamSocketCluster (it writes the data).
// web-jam-back only reads from the same Mongo `gigs` collection — keep the
// shape and explicit collection name in sync with that repo.
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
}, options);

// Gigs live in WebJamSocketCluster's Mongo, a DIFFERENT database than
// web-jam-back's default connection. Always bind the Gig model to a dedicated
// connection: GIGS_MONGO_DB_URI in production (the gigs DB), falling back to
// MONGO_DB_URI otherwise. This means CI/tests exercise the exact same
// createConnection code path as production — just pointed at the test DB — so
// no separate CI env var is needed and prod is never reachable from tests.
// (web-jam-back#814)
const gigsUri = process.env.GIGS_MONGO_DB_URI || process.env.MONGO_DB_URI || '';
const conn = mongoose.createConnection(gigsUri);

export default conn.models.Gig || conn.model('Gig', gigSchema, 'gigs');

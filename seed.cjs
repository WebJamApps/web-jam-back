const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const uri = process.env.MONGO_DB_URI || 'mongodb://localhost:27017/web-jam-dev';

mongoose.connect(uri).then(async () => {
  console.log('Connected to ' + uri);
  
  const venueSchema = new mongoose.Schema({}, { strict: false });
  const Venue = mongoose.models.Venue || mongoose.model('Venue', venueSchema);
  
  await Venue.create({
    name: 'The Golden Pony',
    city: 'Harrisonburg',
    usState: 'VA',
    venueType: 'Originals',
    email: 'booking@goldenponyva.com',
    status: 'active',
    outreachEligible: true,
    inScope: true,
    bookingStatus: 'booking'
  });
  
  await Venue.create({
    name: 'Martin\'s Downtown',
    city: 'Roanoke',
    usState: 'VA',
    venueType: 'PubFestivalBrewery',
    email: 'martins@example.com',
    status: 'active',
    outreachEligible: true,
    inScope: true,
    bookingStatus: 'booking'
  });

  await Venue.create({
    name: 'Awful Arthurs',
    city: 'Salem',
    usState: 'VA',
    venueType: 'MidRangeCafeBar',
    email: 'awful@example.com',
    status: 'active',
    outreachEligible: true,
    inScope: true,
    bookingStatus: 'booking'
  });

  console.log('Inserted 3 eligible venues for testing.');
  mongoose.connection.close();
}).catch(console.error);

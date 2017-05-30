const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const volunteerSchema = new Schema({
  volFKuserID: { type: String, required: true },
  volTravelDistMiles: { type: Number, required: false },
  volCauses: { type: [String], required: false },
  volTalents: { type: [String], required: false },
  volWorkPrefs: { type: [String], required: false }
});

module.exports = mongoose.model('Volunteer', volunteerSchema);

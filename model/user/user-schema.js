const mongoose = require('mongoose');
const Schema   = mongoose.Schema;


const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  isOhafUser: { type: Boolean, required: false },
  userPhone: { type: Number, required: false },
  userStatus: { type: String, required: false },
  userType: { type: String, required: false },
  userStreetAddress: { type: String, required: false },
  userCity: { type: String, required: false },
  userState: { type: String, required: false },
  userZip: { type: String, required: false },
  userDetails:{ type: String, required: false },
  volTravelDistMiles: { type: Number, required: false },
  volCauses: { type: [String], required: false },
  volTalents: { type: [String], required: false },
  volWorkPrefs: { type: [String], required: false },
  volCauseOther:{ type: String, required: false },
  volTalentOther:{ type: String, required: false },
  volWorkOther:{ type: String, required: false }
});


module.exports = mongoose.model('User', userSchema);

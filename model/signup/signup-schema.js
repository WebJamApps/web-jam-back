const mongoose = require('mongoose');
const Schema   = mongoose.Schema;


const signupSchema = new Schema({
  voloppId: { type: String, required: true },
  userId: { type: String, required: true },
  numPeople: { type: Number, required: true },
  groupName: { type: String, required: false }
  // name: { type: String, required: true },
  // email: { type: String, required: true, unique: true },
  // userPhone: { type: Number, required: false },
  // userType: { type: String, required: false },
  // userCity: { type: String, required: false },
  // userZip: { type: String, required: false },
  // userDetails:{ type: String, required: false },
  // volTravelDistMiles: { type: Number, required: false },
  // volCauses: { type: [String], required: false },
  // volTalents: { type: [String], required: false },
  // volWorkPrefs: { type: [String], required: false },
  // volCauseOther:{ type: String, required: false },
  // volTalentOther:{ type: String, required: false },
  // volWorkOther:{ type: String, required: false }
});


module.exports = mongoose.model('Signup', signupSchema);

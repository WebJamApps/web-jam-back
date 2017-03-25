const mongoose = require('mongoose');
const Schema   = mongoose.Schema;


const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  userPhone: { type: Number, required: false },
  userType: { type: String, required: false },
  userCity: { type: String, required: false },
  userZip: { type: Number, required: false },
  userDetails:{ type: String, required: false }
});


module.exports = mongoose.model('User', userSchema);

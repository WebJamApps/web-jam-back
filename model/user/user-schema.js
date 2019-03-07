const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const bcrypt = require('bcryptjs');

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  resetCode: { type: String, required: false },
  isPswdReset: { type: Boolean, required: false },
  verifiedEmail: { type: Boolean, required: false },
  changeemail: { type: String, required: false },
  isOhafUser: { type: Boolean, required: false },
  userPhone: { type: Number, required: false },
  userStatus: { type: String, required: false },
  userType: { type: String, required: false },
  userStreetAddress: { type: String, required: false },
  userCity: { type: String, required: false },
  userState: { type: String, required: false },
  userZip: { type: String, required: false },
  userDetails: { type: String, required: false },
  volTravelDistMiles: { type: Number, required: false },
  volCauses: { type: [String], required: false },
  volTalents: { type: [String], required: false },
  volWorkPrefs: { type: [String], required: false },
  volCauseOther: { type: String, required: false },
  volTalentOther: { type: String, required: false },
  volWorkOther: { type: String, required: false }
});

userSchema.pre('save', function pwEcrypt(next) {
  const user = this;
  if (!user.isModified('password') || user.password === '') {
    return next();
  }
  return bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(user.password, salt, (err2, hash) => {
      user.password = hash;
      next();
    });
  });
});

module.exports = mongoose.model('User', userSchema);

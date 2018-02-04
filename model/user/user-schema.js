const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const bcrypt = require('bcryptjs');

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false, select: false },
  resetCode: { type: String, required: false },
  isPswdReset: { type: Boolean, required: false },
  changeemail: { type: String, required: false },
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

userSchema.pre('save', function(next) {
  const user = this;
  if (!user.isModified('password')) {
    return next();
  }
  bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(user.password, salt, (err, hash) => {
      user.password = hash;
      next();
    });
  });
});

// userSchema.methods.comparePassword = function(password, done) {
//   bcrypt.compare(password, this.password, (err, isMatch) => {
//     done(err, isMatch);
//   });
// };

userSchema.methods.validateSignup = function() {
  let message = '';
  if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(this.email))  {
    console.log('email is valid');
  } else {
    message = 'Email address is invalid format';
  }
  if (this.password.length < 8) {
    message = 'Password is not min 8 characters';
  }
  if (this.name === '' || this.name === null || this.name === undefined) {
    message = 'User Name is missing';
  }
  return message;
};

module.exports = mongoose.model('User', userSchema);

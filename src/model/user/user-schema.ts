import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

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
  volWorkOther: { type: String, required: false },
});

userSchema.pre('save', function pwEcrypt(next) {
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const user:any = this;
  if (!this.isModified('password') || user.password === '') {
    return next();
  }
  return bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(user.password, salt, (err2, hash) => {
      user.password = hash;
      next();
    });
  });
});

export default mongoose.model('User', userSchema);

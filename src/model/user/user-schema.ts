import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  verifiedEmail: { type: Boolean, required: false },
  changeemail: { type: String, required: false },
  userPhone: { type: Number, required: false },
  userStatus: { type: String, required: false },
  userType: { type: String, required: false },
  userStreetAddress: { type: String, required: false },
  userCity: { type: String, required: false },
  userState: { type: String, required: false },
  userZip: { type: String, required: false },
  userDetails: { type: String, required: false },
});

export default mongoose.model('User', userSchema);

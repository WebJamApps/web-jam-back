const mongoose = require('mongoose');

const Schema = mongoose.Schema;
const charitySchema = new Schema({
  charityName: { type: String, required: true },
  charityStreet: { type: String, required: false },
  charityCity: { type: String, required: false },
  charityState: { type: String, required: false },
  charityZipCode: { type: String, required: false },
  charityPhoneNumber: { type: String, required: false },
  charityEmail: { type: String, required: false },
  charityTypes: { type: [String], required: false },
  charityManagers: { type: [String], required: false },
  charityMngIds: { type: [String], required: true },
  charityTypeOther: { type: String, required: false }
});

module.exports = mongoose.model('Charity', charitySchema);

const mongoose = require('mongoose');
const Schema   = mongoose.Schema;

const charitySchema = new Schema({
  charityName: { type: String, required: true },
  charityCity: { type: String, required: false },
  charityState: { type: String, required: false },
  charityZipCode: { type: Number, required: true },
  charityPhoneNumber: { type: Number, required: false },
  charityEmail: { type: String, required: false },
  charityType: { type: [String], required: false },
  charityManagers: { type: [String], required: false }
  // title: { type: String, required: true },
  // type: { type: String, required: true },
  // author: { type: String, required: false },
  // numberPages: { type: Number, required: false },
  // dateOfPub: { type: Number, required: false },
  // url: { type: String, required: false },
  // // isCheckedOut: { type: Number, required: false },
  // // isbn is either the GE number or the orderable number from a bookstore
  // isbn: { type: String, required: false },
  // siteLocation: { type: String, required: false },
  // numberOfCopies: { type: Number, required: false },
  // access: { type: String, required: false },
  // comments: { type: String, required: false },
  // checkedOutBy: { type: String, required: false },
  // checkedOutByName: { type: String, required: false }
});

module.exports = mongoose.model('Charity', charitySchema);

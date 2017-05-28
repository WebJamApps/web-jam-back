const mongoose = require('mongoose');
const Schema   = mongoose.Schema;

const volunteerSchema = new Schema({
  volunteerFCuserID: { type: String, required: true },
  volTravelDistMiles: { type: Number, required: false }
  // volunteerCity: { type: String, required: true },
  // charityState: { type: String, required: true },
  // charityZipCode: { type: Number, required: true }
  // charityPhoneNumber: { type: Number, required: true },
  // charityEmail: { type: String, required: false },
  // charityType: { type: [String], required: true },
  // charityManagers: { type: [String], required: true }
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

module.exports = mongoose.model('Volunteer', volunteerSchema);

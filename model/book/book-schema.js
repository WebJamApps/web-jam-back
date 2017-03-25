const mongoose = require('mongoose');
const Schema   = mongoose.Schema;


const bookSchema = new Schema({
  title: { type: String, required: true },
  type: { type: String, required: true },
  author: { type: String, required: false },
  numberPages: { type: Number, required: false },
  dateOfPub: { type: Number, required: false },
  url: { type: String, required: false },
  // isCheckedOut: { type: Number, required: false },
// isbn is either the GE number or the orderable number from a bookstore
  isbn: { type: String, required: false },
  siteLocation: { type: String, required: false },
  numberOfCopies: { type: Number, required: false },
  comments: { type: String, required: false }
});


module.exports = mongoose.model('Book', bookSchema);

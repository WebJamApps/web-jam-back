const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const pictureSchema = new Schema({
  alt: { type: String, required: true },
  src: { type: String, required: true },
  page: { type: String, required: true },
  slideShow: { type: String, default: '' },
  width: { type: Number },
  height: { type: Number }
});

module.exports = mongoose.model('Picture', pictureSchema);

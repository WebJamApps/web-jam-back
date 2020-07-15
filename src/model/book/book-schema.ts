import mongoose from 'mongoose';

const options = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
};

const { Schema } = mongoose;

const bookSchema = new Schema({
  title: { type: String, required: true },
  type: { type: String, required: true },
  author: { type: String, required: false },
  numberPages: { type: Number, required: false },
  dateOfPub: { type: Number, required: false },
  url: { type: String, required: false },
  // isbn is the orderable number from a bookstore
  isbn: { type: String, required: false },
  siteLocation: { type: String, required: false },
  numberOfCopies: { type: Number, required: false },
  access: { type: String, required: false },
  comments: { type: String, required: false },
  checkedOutBy: { type: String, required: false },
  checkedOutByName: { type: String, required: false },
}, options);

export default mongoose.model('Book', bookSchema);

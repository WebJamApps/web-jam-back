const Model = require('../../lib/facade');
const bookSchema  = require('./book-schema');


class BookModel extends Model {
  // TODO: Determine if findByTitle method needs have the facade and schema linked
  // findByTitle(title) {
  //   return this.bookSchema
  //   .findByTitle(title)
  //   .exec();
  // }


}

module.exports = new BookModel(bookSchema);

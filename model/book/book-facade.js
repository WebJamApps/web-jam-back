const Model = require('../../lib/facade');
const bookSchema  = require('./book-schema');


class BookModel extends Model {

}

module.exports = new BookModel(bookSchema);

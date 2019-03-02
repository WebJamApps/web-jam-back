const Controller = require('../../lib/controller');
const bookModel = require('./book-facade');

class BookController extends Controller {
  findCheckedOut(req, res) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then(collection => res.status(200).json(collection));
  }
}

module.exports = new BookController(bookModel);

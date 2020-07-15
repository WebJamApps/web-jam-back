import Controller from '../../lib/controller';
import bookModel from './book-facade';

class BookController extends Controller {
  findCheckedOut(req, res) {
    return this.model.find({ checkedOutBy: req.params.id })
      .then((collection) => res.status(200).json(collection));
  }
}

export default new BookController(bookModel);

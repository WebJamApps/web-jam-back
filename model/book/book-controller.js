const Controller = require('../../lib/controller');
const bookModel  = require('./book-facade');

class BookController extends Controller {

  find(req, res, next) {
    return this.model.find(req.query)
    .then((collection) => {
      console.log(collection.length);
      if (collection.length) return res.status(200).json(collection);
      return next(new Error('Bookshelf Empty'));
    });
  }

  remove(req, res, next) {
    return this.model.remove(req.query);
    // .then((doc) => {
    //   if (!doc) {
    //     return res.status(404).send({ message: 'Delete id is invalid' });
    //   }
    //   return res.status(204).end();
    // });
  }
  // findByTitle(req, res, next) {
  //   let bar = this.model;
  //   let result =  this.model.find({
  //     'title' : req.params.title
  //   })
  //   .then(doc => {
  //     if (!doc) {
  //       return res.status(404).end();
  //     }
  //     return res.status(200).json(doc);
  //   })
  //   .catch(err => next(err));
  //
  //   return result;
  // }
}

module.exports = new BookController(bookModel);

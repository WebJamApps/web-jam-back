const Controller = require('../../lib/controller');
const bookModel = require('./book-facade');

class BookController extends Controller {
  findCheckedOut(req, res) {
    // console.log('this is the user id: ' + req.params.id);
    return this.model.find({ checkedOutBy:req.params.id })
      .then(collection => res.status(200).json(collection));
  }

  deleteMany(req, res) {
    return this.model.deleteMany(req.query)
      .then((collection) => {
        // console.log(req.query);
        res.status(200).json(collection);
      });
  }
  // .then((doc) => {
  //   if (!doc) {
  //     return res.status(404).send({ message: 'Delete id is invalid' });
  //   }
  //   return res.status(204).end();
  // });
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

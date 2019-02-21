const Controller = require('../../lib/controller');
const bookModel = require('./book-facade');

class BookController extends Controller {
  findCheckedOut(req, res) {
    // console.log('this is the user id: ' + req.params.id);
    return this.model.find({ checkedOutBy: req.params.id })
      .then(collection => res.status(200).json(collection));
  }

  deleteMany(req, res) {
    return this.model.deleteMany(req.query)
      .then((collection) => {
        // console.log(req.query);
        res.status(200).json(collection);
      });
  }

  async getYouthPics(req, res) {
    console.log('get youth pics');
    let book;
    try {
      book = await this.model.find({ type: 'youthPics' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book.length === 0) {
      return res.status(400).json({ message: 'invalid request' });
    }
    console.log(book);
    return res.status(200).json(book);
  }

  async getFamilyPics(req, res) {
    console.log('get youth pics');
    let book;
    try {
      book = await this.model.find({ type: 'familyPics' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book.length === 0) {
      return res.status(400).json({ message: 'invalid request' });
    }
    console.log(book);
    return res.status(200).json(book);
  }

  async findByType(req, res) {
    let book;
    try {
      book = await this.model.findOne({ type: 'homePageContent' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async findByType2(req, res) {
    let book;
    try {
      book = await this.model.findOne({ type: 'youthPageContent' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async findByType3(req, res) {
    let book;
    try {
      book = await this.model.findOne({ type: 'familyPageContent' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async updateHomePage(req, res) {
    let updatedBook;
    const update = req.body;
    try {
      updatedBook = await this.model.findOneAndUpdate({ type: 'homePageContent' }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
  }

  async updateYouthPage(req, res) {
    let updatedBook;
    const update = req.body;
    try {
      updatedBook = await this.model.findOneAndUpdate({ type: 'youthPageContent' }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
  }

  async updateFamilyPage(req, res) {
    let updatedBook;
    const update = req.body;
    try {
      updatedBook = await this.model.findOneAndUpdate({ type: 'familyPageContent' }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
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

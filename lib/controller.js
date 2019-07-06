const mongoose = require('mongoose');
const debug = require('debug')('web-jam-back:lib/controller');
const AuthUtils = require('../auth/authUtils');

class Controller {
  constructor(model) {
    this.model = model;
    this.authUtils = AuthUtils;
  }

  async findOne(req, res) {
    let book;
    try {
      book = await this.model.findOne(req.query);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async findOneAndUpdate(req, res) {
    let updatedBook;
    try {
      updatedBook = await this.model.findOneAndUpdate(req.query, req.body);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
  }

  async find(req, res) {
    let collection;
    try {
      collection = await this.model.find(req.query);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(200).json(collection);
  }

  findById(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Find id is invalid',
      });
    }
    return this.model.findById(req.params.id)
      .then((doc) => {
        if (!doc) { return res.status(400).json({ message: 'nothing found with id provided' }); }
        if (doc.password !== null && doc.password !== undefined) doc.password = ''; // eslint-disable-line no-param-reassign
        return res.status(200).json(doc);
      });
  }

  async create(req, res) {
    debug('create');
    debug(req.body);
    let single, created, doc;
    const docArray = [];
    const postBody = req.body;
    if (postBody.constructor === Array) {
      const arrayLength = postBody.length;
      for (let i = 0; i < arrayLength; i += 1) {
        try { // eslint-disable-next-line security/detect-object-injection
          doc = await this.model.create(postBody[i]); // eslint-disable-line no-await-in-loop
        } catch (e) {
          debug(e.message);
          return res.status(500).json({ message: e.message });
        }
        docArray.push(doc);
      }
      created = docArray;
    } else {
      try {
        single = await this.model.create(req.body);
      } catch (e) { return res.status(500).json({ message: e.message }); }
      created = single;
    }
    return res.status(201).json(created);
  }

  findByIdAndUpdate(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Update id is invalid',
      });
    }
    if (req.body.userType && ['Volunteer', 'Charity', 'Developer', 'Reader', 'Librarian'].indexOf(req.body.userType) === -1) {
      return res.status(400).send({ message: 'userType not valid' });
    }
    if (req.body.name === '') {
      return res.status(400).send({ message: 'Name is required' });
    }
    return this.model.findByIdAndUpdate(req.params.id, req.body)
      .then((doc) => {
        if (!doc) return res.status(400).send({ message: 'Id Not Found' });
        if (doc.password !== null && doc.password !== undefined) doc.password = ''; // eslint-disable-line no-param-reassign
        return res.status(200).json(doc);
      })
      .catch(e => res.status(500).json({ message: e.message }));
  }

  findByIdAndRemove(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'id is invalid',
      });
    }
    return this.model.findByIdAndRemove(req.params.id)
      .then((doc) => {
        if (!doc) {
          return res.status(400).send({ message: 'Delete id is invalid' });
        }
        return res.status(200).json({ message: `${this.model.Schema.modelName} delete was successful` });
      });
  }

  deleteMany(req, res) {
    return this.model.deleteMany(req.query)
      .then(() => res.status(200).json({ message: `${this.model.Schema.modelName} delete was successful` }))
      .catch(e => res.status(500).json({ message: e.message }));
  }
}

module.exports = Controller;

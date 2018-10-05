const mongoose = require('mongoose');
const AuthUtils = require('../auth/authUtils');

class Controller {
  constructor(model) {
    this.model = model;
    this.authUtils = AuthUtils;
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
        message: 'Find id is invalid'
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
    let single, created;
    const docArray = [];
    const errorArray = [];
    const postBody = req.body;
    if (postBody.constructor === Array) {
      const arrayLength = postBody.length;
      for (let i = 0; i < arrayLength; i += 1) {
        this.model.create(postBody[i])
          .then(doc => docArray.push(doc))
          .catch(e => errorArray.push(e.message));
      }
    } else {
      try {
        single = await this.model.create(req.body);
      } catch (e) { return res.status(500).json({ message: e.message }); }
    }
    if (errorArray.length > 0) return res.status(500).json({ message: errorArray });
    created = docArray;
    if (single !== null && single !== undefined) created = single;
    return res.status(201).json(created);
  }

  findByIdAndUpdate(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Update id is invalid'
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
        message: 'id is invalid'
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
}

module.exports = Controller;

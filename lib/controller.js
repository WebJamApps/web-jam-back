const mongoose = require('mongoose');
const AuthUtils = require('../auth/authUtils');

class Controller {
  constructor(model) {
    this.model = model;
    this.authUtils = new AuthUtils();
  }

  find(req, res, next) {
    return this.model.find(req.query)
      .then(collection => res.status(200).json(collection));
  }

  findById(req, res, next) {
    // only currently used to find the user by id
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Find id is invalid'
      });
    }
    return this.model.findById(req.params.id)
      .then((doc) => {
        if (!doc) { return res.status(404).end(); }
        return res.status(200).json(doc);
      });
  }

  create(req, res, next) {
    const postBody = req.body;
    if (postBody.constructor === Array) {
      const arrayLength = postBody.length;
      const docArray = [];
      for (let i = 0; i < arrayLength; i += 1) {
        this.model.create(postBody[i])
          .then((doc) => {
            docArray.push(doc);
            if (docArray.length === arrayLength) {
              res.status(201).json(docArray);
            }
          });
      }
    } else {
      this.model.create(req.body)
        .then((doc) => {
          res.status(201).json(doc);
        });
    }
  }

  findOneAndUpdate(req, res) {
    const conditions = { _id: req.params.id };
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
    return this.model.findOneAndUpdate(conditions, req.body)
      .then((doc) => {
        if (!doc) return res.status(400).send({ message: 'Id Not Found' });
        return res.status(200).json(doc);
      })
      .catch(e => res.status(500).json({ message: e.message }));
  }

  findByIdAndRemove(req, res, next) {
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
        return res.status(200).json({ message: 'delete was successful' });
      });
  }
}

module.exports = Controller;

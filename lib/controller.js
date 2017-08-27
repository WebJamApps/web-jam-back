// const ErrorHandler = require('./errorHandler');
const mongoose = require('mongoose');

class Controller {
  constructor(model) {
    this.model = model;
  }

  find(req, res, next) {
    return this.model.find(req.query)
    .then((collection) => {
      console.log(collection.length);
      return res.status(200).json(collection);
    });
  }

  // findOne(req, res, next) {
  //   return this.model.findOne(req.query)
  //   .then(doc => res.status(200).json(doc))
  //   .catch(err => next(err));
  // }

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

  update(req, res, next) {
    const conditions = { _id: req.params.id };
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Update id is invalid'
      });
    }
    if (req.body.userType && ['Volunteer', 'Charity', 'Developer', 'Reader', 'Librarian'].indexOf(req.body.userType) === -1) {
      return res.status(404).send({ message: 'userType not valid' });
    }
    this.model.update(conditions, req.body)
    .then((doc) => {
      console.log(doc);
      return res.status(200).json(doc);
    });
  }

  findByIdAndRemove(req, res, next) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).send({
        message: 'Delete id is invalid'
      });
    }
    return this.model.findByIdAndRemove(req.params.id)
    .then((doc) => {
      if (!doc) {
        return res.status(404).send({ message: 'Delete id is invalid' });
      }
      return res.status(204).end();
    });
  }

}

module.exports = Controller;

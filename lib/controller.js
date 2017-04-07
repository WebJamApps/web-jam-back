const ErrorHandler = require('./errorHandler');
const mongoose = require('mongoose');

class Controller {
  constructor(model) {
    this.model = model;
    this._errorHandler = new ErrorHandler();
  }

//   find(req, res, next) {
//     return this.model.find(req.query)
// .then(collection => res.status(200).json(collection));
//   }

  // findOne(req, res, next) {
  //   return this.model.findOne(req.query)
  //   .then(doc => res.status(200).json(doc))
  //   .catch(err => next(err));
  // }

  findById(req, res, next) {
    // validate the request ID before finding.
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).send({
             message: 'Id is invalid'
          });
    }
    return this.model.findById(req.params.id)
    .then(doc => {
      if (!doc) { return res.status(404).end(); }
      return res.status(200).json(doc);
    });
  }

  create(req, res, next) {
    // console.log(req.body);
    const postBody = req.body;
    if (postBody.constructor === Array) {
      const arrayLength = postBody.length;
      const docArray = [];
      for (let i = 0; i < arrayLength; i++) {
        this.model.create(postBody[i])
// TODO: Insert each response into an array and send only that single array back to the client YES
        // .then((doc) => {
        //   res.status(201).json(doc);
        //   console.log(doc);
        // })

        .then((doc) => {
          docArray.push(doc);
          if (docArray.length === arrayLength) {
            res.status(201).json(docArray);
            // console.log(docArray);
          }
        });

        // .catch((err) => {
        //   next(err);
      // });
      }
    } else {
      this.model.create(req.body)
      .then((doc) => {
        res.status(201).json(doc);
        // console.log(doc);
      // })
      // .catch((err) => {
      //   next(err);
      });
    }
  }

  update(req, res, next) {
    const conditions = { _id: req.params.id };
// TODO: Write some code to validate if ID is valid
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).send({
            message: 'Id is invalid'
        });
    }
if (req.body.userType && ['Volunteer', 'Charity', 'Developer'].indexOf(req.body.userType) === -1) {
      return res.status(404).send({ message: 'userType not valid' });
    }
    this.model.update(conditions, req.body)
    .then(doc => {
      if (doc.nModified === 0) {
        return this._errorHandler.internalServerError('Could not update user', req, res, next);
      }
      
      return res.status(200).json(doc);
    });
  }

  // remove(req, res, next) {
  //   this.model.remove(req.params.id)
  //   .then(doc => {
  //     if (!doc) { return res.status(404).end(); }
  //     return res.status(204).end();
  //   })
  //   .catch(err => next(err));
  // }

}

module.exports = Controller;

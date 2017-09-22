const Controller = require('../../lib/controller');
const signupModel  = require('./signup-facade');

class SignupController extends Controller {
  findByUserId(req, res, next) {
    console.log('this is the user id: ' + req.params.id);
    return this.model.find({ userId:req.params.id })
    .then((collection) => {
      console.log(collection.length);
      return res.status(200).json(collection);
    });
  }

  findByEventId(req, res, next) {
    console.log('this is the event id: ' + req.params.id);
    return this.model.find({ voloppId:req.params.id })
    .then((collection) => {
      console.log(collection.length);
      return res.status(200).json(collection);
    });
  }

  remove(req, res, next) {
    console.log('this is the event id: ' + req.params.id);
    return this.model.remove({ voloppId:req.params.id })
    .then((doc) => {
      console.log(doc);
      // if (!doc) {
      //   return res.status(404).send({ message: 'Delete id is invalid' });
      // }
      return res.status(204).end();
    });
  }

  removeByUserId(req, res, next) {
    console.log('this is the user id: ' + req.params.id);
    return this.model.remove({ userId:req.params.id })
    .then((doc) => {
      console.log(doc);
      // if (!doc) {
      //   return res.status(404).send({ message: 'Delete id is invalid' });
      // }
      return res.status(204).end();
    });
  }

}

module.exports = new SignupController(signupModel);

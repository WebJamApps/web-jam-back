const Controller = require('../../lib/controller');
const userModel = require('./user-facade');


class UserController extends Controller {
  find(req, res, next) {
    console.log('this is the user email: ' + req.body.email);
    return this.model.find({ email:req.body.email })
      .then((collection) => {
        console.log(collection.length);
        return res.status(200).json(collection);
      });
  }

}

module.exports = new UserController(userModel);

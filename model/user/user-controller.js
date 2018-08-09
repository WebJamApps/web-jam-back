const Controller = require('../../lib/controller');
const userModel = require('./user-facade');


class UserController extends Controller {
  find(req, res) {
    return this.model.find({ email:req.body.email })
      .then(collection => res.status(200).json(collection))
      .catch(err => res.status(500).json({ message: 'failed to find user by email', error: err }));
  }
}

module.exports = new UserController(userModel);

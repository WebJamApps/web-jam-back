const Controller = require('../../lib/controller');
const userModel  = require('./user-facade');


class UserController extends Controller {
  findByIdAndRemove(req, res, next) {
    console.log('the id is: ' + req.params.id);
    console.log('this is the model: ' + this.model);
    return this.model.findByIdAndRemove(req.params.id)
    .then((doc) => {
      if (!doc) { return res.status(404).end(); }
      return res.status(204).end();
    })
    .catch(err => next(err));
  }
}

module.exports = new UserController(userModel);

const Controller = require('../../lib/controller');
const userModel = require('./user-facade');


class UserController extends Controller {
  find(req, res) {
    return this.model.find({ email:req.body.email })
      .then(collection => res.status(200).json(collection))
      .catch(err => res.status(500).json({ message: 'failed to find user by email', error: err }));
  }

  async validateEmail(req, res) {
    let myUser;
    try {
      myUser = this.model.findOne({ email: req.body.email, resetCode: req.body.resetCode });
    } catch (e) { return res.status(500).json({ message:e.message }); }
    if (myUser === null || myUser === undefined) return res.status(401).json({ message: 'incorrect email or code' });
    myUser.resetCode = '';
    myUser.isPswdReset = false;
    myUser.verifiedEmail = true;
    return myUser.save((err) => {
      if (err) return res.status(500).json({ message:err.message });
      return res.status(200).json(myUser);
    });
  }
}

module.exports = new UserController(userModel);

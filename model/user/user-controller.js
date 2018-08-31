const Controller = require('../../lib/controller');
const userModel = require('./user-facade');


class UserController extends Controller {
  find(req, res) {
    return this.model.find({ email:req.body.email })
      .then(collection => res.status(200).json(collection))
      .catch(err => res.status(500).json({ message: 'failed to find user by email', error: err }));
  }

  async validateEmail(req, res) {
    let updatedUser;
    // try {
    //   myUser = await this.model.findOne({ email: req.body.email, resetCode: req.body.resetCode });
    // } catch (e) { return res.status(500).json({ message:e.message }); }
    // if (myUser === null || myUser === undefined) return res.status(401).json({ message: 'incorrect email or code' });
    const update = { resetCode: '', isPswdReset:false, verifiedEmail:true };
    try {
      updatedUser = await this.model.findOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update);
    } catch (e) { return res.status(500).json({ message:e.message }); }
    if (updatedUser === null || updatedUser === undefined) return res.status(401).json({ message: 'incorrect email or code' });
    return res.status(200).json(updatedUser);
  }

  resetpass(req, res) {
    // console.log('email:' + req.body.email);
    this.model.findOne({ email: req.body.email }, (err, user) => {
      if (err) return res.status(500).json(e.message);
      // console.log(user);
      if (!user) return res.status(401).json({ message: 'incorrect email address' });
      if (!user.verifiedEmail) return res.status(401).json({ message: 'Verify your email address' });
      const randomNumba = authUtils.generateCode(99999, 10000);
      user.resetCode = randomNumba;
      user.isPswdReset = true;
      return user.save((err) => {
        res.status(200).json({ email: user.email });
        const mailBody = '<h2>A password reset was requested for ' + user.name
        + '.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="'
        + frontURL + '/userutil/?email=' + user.email + '&form=reset">'
        + 'link</a>, then enter the following code to reset your password: <br><br><strong>'
        + randomNumba + '</strong></p><p><i>If a reset was requested in error, you can ignore this email and login to web-jam.com as usual.</i></p>';
        this.authUtils.sendGridEmail(mailBody, user.email, 'Password Reset');
      });
    });
  }
}

module.exports = new UserController(userModel);

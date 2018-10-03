const Controller = require('../../lib/controller');
const userModel = require('./user-facade');

class UserController extends Controller {
  find(req, res) { // TODO make this a get with query and also update frontend fetch request
    return this.model.find({ email: req.body.email })
      .then(collection => res.status(200).json(collection))
      .catch(err => res.status(500).json({ message: 'failed to find user by email', error: err }));
  }

  handleAuth(req, res) {
    return this[req.params.id](req, res);
  }

  async validateemail(req, res) {
    let updatedUser;
    const update = { resetCode: '', isPswdReset: false, verifiedEmail: true };
    try {
      updatedUser = await this.model.findOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedUser === null || updatedUser === undefined) return res.status(400).json({ message: 'incorrect email or code' });
    return res.status(200).json(updatedUser);
  }

  async updateemail(req, res) { // validate with pin then change the email address
    let user, updatedUser;
    const update = {};
    try {
      await this.authUtils.checkEmailSyntax(req);
    } catch (e) { return res.status(400).json({ message: e.message }); }
    try {
      user = await this.model.findOne({ email: req.body.email });
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
    if (user === null || user === undefined || user._id === null || user._id === undefined) {
      return res.status(400).json({ message: 'User does not exist' });
    }
    if (user.resetCode !== req.body.resetCode) {
      return res.status(400).json({ message: 'Reset code is wrong' });
    }
    if (user.changeemail !== req.body.changeemail) {
      return res.status(400).json({ message: 'Reset email is not valid' });
    }
    update.resetCode = '';
    update.email = req.body.changeemail;
    update.changeemail = '';
    try {
      updatedUser = await this.model.findOneAndUpdate({ email: req.body.email }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(200).json(updatedUser);
  }

  async resetpswd(req, res) {
    let user;
    const updateUser = {};
    try {
      user = await this.model.findOne({ email: req.body.email });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user === null || user === undefined || user.id === null || user._id === undefined) {
      return res.status(400).json({ message: 'incorrect email address' });
    }
    if (!user.verifiedEmail) return res.status(401).json({ message: 'Verify your email address' });
    const randomNumba = this.authUtils.generateCode(99999, 10000);
    updateUser.resetCode = randomNumba;
    updateUser.isPswdReset = true;
    try {
      await this.model.findOneAndUpdate({ _id: user._id }, updateUser);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    const mailBody = `<h2>A password reset was requested for ${user.name
    }.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="`
        + `${process.env.frontURL}/userutil/?email=${user.email}&form=reset">`
        + `link</a>, then enter the following code to reset your password: <br><br><strong>${
          randomNumba}</strong></p><p><i>If a reset was requested in error, you can ignore this email and login to web-jam.com as usual.</i></p>`;
    this.authUtils.sendGridEmail(mailBody, user.email, 'Password Reset');
    return res.status(200).json({ email: user.email });
  }

  async changeemail(req, res) {
    let user1, user2;
    const updateUser = {};
    try {
      await this.authUtils.checkEmailSyntax(req);
    } catch (e) { return res.status(400).json({ message: e.message }); }
    try {
      user1 = await this.model.findOne({ email: req.body.changeemail });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user1 !== null) {
      return res.status(409).json({ message: 'Email address already exists' });
    }
    try {
      user2 = await this.model.find({ email: req.body.email });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user2 === null || user2 === undefined || user2.length === 0) {
      return res.status(400).json({ message: 'current user does not exist' });
    }
    updateUser.resetCode = this.authUtils.generateCode(99999, 10000);
    updateUser.changeemail = req.body.changeemail;
    try {
      await this.model.findOneAndUpdate({ email: req.body.email }, updateUser);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    const mailBody = `<h2>Email Address Change Request for ${user2.name
    }.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="${
      process.env.frontURL}/userutil/?changeemail=${updateUser.changeemail}">`
          + `link</a>, then enter the following code to validate this new email: <br><br><strong>${
            updateUser.resetCode}</strong></p><p><i>If this email change was requested in error, you can ignore it and login as usual.</i></p>`;
    this.authUtils.sendGridEmail(mailBody, updateUser.changeemail, 'Web Jam LLC User Account - Email Change Request');
    return res.status(200).json({ success: true });
  }
}

module.exports = new UserController(userModel);

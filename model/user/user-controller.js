const Controller = require('../../lib/controller');
const userModel = require('./user-facade');

class UserController extends Controller {
  async findByEmail(req, res) {
    let user;
    try {
      user = await this.model.findOne({ email: req.body.email });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user === undefined || user === null || user._id === null || user._id === undefined) {
      return res.status(400).json({ message: 'wrong email' });
    }
    user.password = '';
    return res.status(200).json(user);
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
    updatedUser.password = '';
    return res.status(200).json(updatedUser);
  }

  async updateemail(req, res) { // validate with pin then change the email address
    let user, updatedUser, fourHundred = '';
    const update = {};
    try {
      user = await this.model.findOne({ email: req.body.email });
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
    if (user === null || user === undefined || user._id === null || user._id === undefined) {
      fourHundred = 'User does not exist';
    } else if (user.resetCode !== req.body.resetCode) {
      fourHundred = 'Reset code is wrong';
    } else if (user.changeemail !== req.body.changeemail) {
      fourHundred = 'Reset email is not valid';
    }
    if (fourHundred !== '') return res.status(400).json({ message: fourHundred });
    update.resetCode = '';
    update.email = req.body.changeemail;
    update.changeemail = '';
    try {
      updatedUser = await this.model.findOneAndUpdate({ email: req.body.email }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    updatedUser.password = '';
    return res.status(200).json(updatedUser);
  }

  async pswdreset(req, res) { // changes the password after code is verified
    if (req.body.password === null || req.body.password === undefined || req.body.password.length < 8) {
      return res.status(400).send({ message: 'Password is not min 8 characters' });
    }
    let user;
    const update = {};
    update.resetCode = '';
    update.isPswdReset = false;
    update.password = req.body.password;
    try {
      user = await this.model.findOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user === null || user._id === null || user._id === undefined) return res.status(401).json({ message: 'wrong email or reset code' });
    user.password = '';
    return res.status(200).json(user);
  }

  async resetpswd(req, res) { // initial request to reset password
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

  async validateChangeEmail(req) {
    let user1, user2;
    try {
      user1 = await this.model.findOne({ email: req.body.changeemail });
    } catch (e) { return Promise.reject(e); }
    if (user1 !== null) return Promise.reject(new Error('Email address already exists'));
    try {
      user2 = await this.model.find({ email: req.body.email });
    } catch (e) { return Promise.reject(e); }
    if (user2 === null || user2 === undefined || user2.length === 0) {
      return Promise.reject(new Error('current user does not exist'));
    }
    return Promise.resolve(user2);
  }

  async changeemail(req, res) {
    let user2;
    const updateUser = {};
    try {
      await this.authUtils.checkEmailSyntax(req);
    } catch (e) { return res.status(400).json({ message: e.message }); }
    try {
      user2 = await this.validateChangeEmail(req);
    } catch (e) { return res.status(500).json({ message: e.message }); }
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

  async login(req, res) {
    let user, fourOone = '';
    const reqUserEmail = this.authUtils.setIfExists(req.body.email);
    const myPassword = this.authUtils.setIfExists(req.body.password);
    if (reqUserEmail === '' || myPassword === '') return res.status(400).json({ message: 'email and password are required' });
    try {
      user = await this.model.findOne({ email: reqUserEmail });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user === undefined || user === null || user._id === undefined || user._id === null) {
      fourOone = 'Wrong email address';
    } else if (user.password === '' || user.password === null || user.password === undefined) {
      fourOone = 'Please reset your password';
    } else if (!user.verifiedEmail) fourOone = '<a href="/userutil">Verify</a> your email';
    if (fourOone !== '') return res.status(401).json({ message: fourOone });
    return user.comparePassword(req.body.password, (err, isMatch) => {
      if (!isMatch) { return res.status(401).json({ message: 'Wrong password' }); }
      return this.authUtils.saveSendToken(user, req, res);
    });
  }
}

module.exports = new UserController(userModel);

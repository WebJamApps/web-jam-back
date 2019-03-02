const Controller = require('../../lib/controller');
const userModel = require('./user-facade');
const google = require('../../auth/google');

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

  authFindOneAndUpdate(matcher, update, res) {
    return this.findOneAndUpdate({ query: matcher, body: update }, res);
  }

  validateemail(req, res) {
    const update = { resetCode: '', isPswdReset: false, verifiedEmail: true };
    return this.authFindOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update, res);
  }

  updateemail(req, res) { // validate with pin then change the email address
    const update = {};
    const matcher = { email: req.body.email };
    matcher.resetCode = req.body.resetCode;
    matcher.changeemail = req.body.changeemail;
    update.resetCode = '';
    update.email = req.body.changeemail;
    update.changeemail = '';
    return this.findOneAndUpdate({ query: matcher, body: update }, res);
  }

  async pswdreset(req, res) { // changes the password after code is verified
    if (req.body.password === null || req.body.password === undefined || req.body.password.length < 8) {
      return res.status(400).send({ message: 'Password is not min 8 characters' });
    }
    let encrypted;
    const update = {};
    update.resetCode = '';
    update.isPswdReset = false;
    try {
      encrypted = await this.model.encryptPswd(req.body.password);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    update.password = encrypted;
    return this.authFindOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update, res);
  }

  async resetpswd(req, res) { // initial request to reset password
    let user;
    const updateUser = {};
    const randomNumba = this.authUtils.generateCode(99999, 10000);
    updateUser.resetCode = randomNumba;
    updateUser.isPswdReset = true;
    try {
      user = await this.model.findOneAndUpdate({ email: req.body.email, verifiedEmail: true }, updateUser);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (user === null || user === undefined) return res.status(400).json({ message: 'invalid reset password request' });
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

  async finishLogin(res, isPW, user) {
    let loginUser;
    const updateData = {};
    if (!isPW) return res.status(401).json({ message: 'Wrong password' });
    updateData.isPswdReset = false;
    updateData.resetCode = '';
    updateData.changeemail = '';
    try {
      loginUser = await this.model.findByIdAndUpdate(user._id, updateData);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    loginUser.password = '';
    const userToken = { token: this.authUtils.createJWT(loginUser), email: loginUser.email };
    return res.status(200).json(userToken);
  }

  async login(req, res) {
    let user, fourOone = '', isPW;
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
    try {
      isPW = await this.model.comparePassword(req.body.password, user.password);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    return this.finishLogin(res, isPW, user);
  }

  async finishSignup(res, user, randomNumba) {
    let userSave;
    try {
      userSave = await this.model.create(user);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    const mailbody = `<h1>Welcome ${userSave.name
    } to Web Jam Apps.</h1><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" `
        + `href="${process.env.frontURL}/userutil/?email=${userSave.email}">link</a>, then enter the following code to verify your email:`
        + `<br><br><strong>${randomNumba}</strong></p>`;
    this.authUtils.sendGridEmail(mailbody, userSave.email, 'Verify Your Email Address');
    userSave.password = '';
    return res.status(201).json(userSave);
  }

  async signup(req, res) {
    let existingUser;
    const randomNumba = this.authUtils.generateCode(99999, 10000);
    const user = {
      name: req.body.name,
      verifiedEmail: false,
      email: req.body.email,
      password: req.body.password,
      isPswdReset: false,
      resetCode: randomNumba
    };
    const validData = this.model.validateSignup(user);
    if (validData !== '') return res.status(409).send({ message: validData });
    try {
      existingUser = await this.model.findOne({ email: req.body.email });
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (existingUser && existingUser.verifiedEmail) {
      return res.status(409).send({ message: 'This email address has already been registered.' });
    }
    if (existingUser && !existingUser.verifiedEmail) {
      try {
        await this.model.findByIdAndRemove(existingUser._id);
      } catch (e) { return res.status(500).json({ message: e.message }); }
    }
    return this.finishSignup(res, user, randomNumba);
  }

  async google(req, res) {
    let newUser, existingUser, profile;
    try {
      profile = await google.authenticate(req);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    // Step 3. Create a new user account or return an existing one.
    const update = {};
    update.password = '';
    update.name = profile.name; // force the name of the user to be the name from google account
    update.verifiedEmail = true;
    try {
      existingUser = await this.model.findOneAndUpdate({ email: profile.email }, update);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (existingUser) return res.status(200).json({ email: existingUser.email, token: this.authUtils.createJWT(existingUser) });
    const user = {};
    user.name = profile.name;
    user.email = profile.email;
    user.isOhafUser = req.body.isOhafUser;
    user.verifiedEmail = true;
    try {
      newUser = await this.model.create(user);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    newUser.password = '';
    return res.status(201).json({ email: newUser.email, token: this.authUtils.createJWT(newUser) });
  }
}
module.exports = new UserController(userModel);

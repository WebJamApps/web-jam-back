import { Request, Response } from 'express';
import Debug from 'debug';
import Controller from '../../lib/controller';
import userModel from './user-facade';
import authGoogle from '../../auth/google';

const debug = Debug('web-jam-back:user-controller');

class UserController extends Controller {
  authGoogle: typeof authGoogle;

  constructor(uModel: any) {
    super(uModel);
    this.authGoogle = authGoogle;
  }

  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  async findByEmail(req: Request, res: Response) {
    let user;
    try { user = await this.model.findOne({ email: req.body.email }); } catch (e) { return this.resErr(res, e); }
    if (user === undefined || user === null || user._id === null || user._id === undefined) {
      return res.status(400).json({ message: 'wrong email' });
    }
    user.password = '';
    return res.status(200).json(user);
  }
  
  // handleAuth(req: Request, res: Response) { return this[req.params.id](req, res); }

  // authFindOneAndUpdate(matcher: any, update: any, res: Response) { return this.findOneAndUpdate({ query: matcher, body: update }, res); }

  // validateemail(req: Request, res: Response) {
  //   const update = { resetCode: '', isPswdReset: false, verifiedEmail: true };
  //   return this.authFindOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update, res);
  // }

  // updateemail(req: Request, res: Response) { // validate with pin then change the email address
  //   const update: any = {};
  //   const matcher: any = { email: req.body.email };
  //   matcher.resetCode = req.body.resetCode;
  //   matcher.changeemail = req.body.changeemail;
  //   update.resetCode = '';
  //   update.email = req.body.changeemail;
  //   update.changeemail = '';
  //   return this.findOneAndUpdate({ query: matcher, body: update }, res);
  // }

  // async pswdreset(req: any, res: any) { // changes the password after code is verified
  //   if (req.body.password === null || req.body.password === undefined || req.body.password.length < 8) {
  //     return res.status(400).json({ message: 'Password is not min 8 characters' });
  //   }
  //   let encrypted;
  //   const update: any = {};
  //   update.resetCode = '';
  //   update.isPswdReset = false;
  //   try { encrypted = await this.model.encryptPswd(req.body.password); } catch (e) { return this.resErr(res, e); }
  //   update.password = encrypted;
  //   return this.authFindOneAndUpdate({ email: req.body.email, resetCode: req.body.resetCode }, update, res);
  // }

  // async resetpswd(req: any, res: any) { // initial request to reset password
  //   debug('resetpswd');
  //   let user;
  //   const updateUser: any = {};
  //   const randomNumba = this.authUtils.generateCode(99999, 10000);
  //   updateUser.resetCode = randomNumba;
  //   updateUser.isPswdReset = true;
  //   try {
  //     user = await this.model.findOneAndUpdate({ email: req.body.email, verifiedEmail: true }, updateUser);
  //   } catch (e) { return this.resErr(res, e); }
  //   if (user === null || user === undefined) return res.status(400).json({ message: 'invalid reset password request' });
  //   const mailBody = `<h2>A password reset was requested for ${user.name
  //   }.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="`
  //     + `${process.env.frontURL}/userutil/?email=${user.email}&form=reset">`
  //     + `link</a>, then enter the following code to reset your password: <br><br><strong>${
  //       randomNumba}</strong></p><p><i>If a reset was requested in error, you can ignore this email and login to web-jam.com as usual.</i></p>`;
  //   this.authUtils.sendGridEmail(mailBody, user.email, 'Password Reset');
  //   return res.status(200).json({ email: user.email });
  // }

  // async validateChangeEmail(req: Request) {
  //   let user1;
  //   try { user1 = await this.model.findOne({ email: req.body.changeemail }); } catch (e) { return Promise.reject(e); }
  //   if (user1 !== null) return Promise.reject(new Error('Email address already exists'));
  //   return Promise.resolve(user1);
  // }

  // async changeemail(req: Request, res: Response) {
  //   let result;
  //   const updateUser: any = {};
  //   try {
  //     await this.authUtils.checkEmailSyntax(req);
  //   } catch (e) { return res.status(400).json({ message: e.message }); }
  //   try { await this.validateChangeEmail(req); } catch (e) { return this.resErr(res, e); }
  //   updateUser.resetCode = this.authUtils.generateCode(99999, 10000);
  //   updateUser.changeemail = req.body.changeemail;
  //   try {
  //     result = await this.model.findOneAndUpdate({ email: req.body.email }, updateUser);
  //   } catch (e) { return this.resErr(res, e); }
  //   const mailBody = `<h2>Email Address Change Request for ${result.name
  //   }.</h2><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" href="${
  //     process.env.frontURL}/userutil/?changeemail=${updateUser.changeemail}">`
  //     + `link</a>, then enter the following code to validate this new email: <br><br><strong>${
  //       updateUser.resetCode}</strong></p><p><i>If this email change was requested in error, you can ignore it and login as usual.</i></p>`;
  //   this.authUtils.sendGridEmail(mailBody, updateUser.changeemail, 'Web Jam LLC User Account - Email Change Request');
  //   return res.status(200).json({ success: true });
  // }

  async finishLogin(res: Response, isPW: boolean, user: any) {
    let loginUser;
    const updateData: any = {};
    if (!isPW) return res.status(401).json({ message: 'Wrong password' });
    updateData.isPswdReset = false;
    updateData.resetCode = '';
    updateData.changeemail = '';
    try { loginUser = await this.model.findByIdAndUpdate(user._id, updateData); } catch (e) { return this.resErr(res, e); }
    loginUser.password = '';
    const userToken = { token: this.authUtils.createJWT(loginUser), email: loginUser.email };
    return res.status(200).json(userToken);
  }

  async login(req: any, res: any) {
    let user, fourOone = '', isPW;
    const reqUserEmail = this.authUtils.setIfExists(req.body.email);
    const myPassword = this.authUtils.setIfExists(req.body.password);
    if (reqUserEmail === '' || myPassword === '') return res.status(400).json({ message: 'email and password are required' });
    try { user = await this.model.findOne({ email: reqUserEmail }); } catch (e) { return this.resErr(res, e); }
    if (user === undefined || user === null || user._id === undefined || user._id === null) {
      fourOone = 'Wrong email address';
    } else if (user.password === '' || user.password === null || user.password === undefined) {
      fourOone = 'Please reset your password';
    } else if (!user.verifiedEmail) fourOone = '<a href="/userutil">Verify</a> your email';
    if (fourOone !== '') return res.status(401).json({ message: fourOone });
    try {
      isPW = this.model.comparePassword ? await this.model.comparePassword(req.body.password, user.password) : /* istanbul ignore next */false; 
    } catch (e) { return this.resErr(res, e); }
    return this.finishLogin(res, isPW, user);
  }

  async finishSignup(res: any, user: any, randomNumba: number) {
    let userSave;
    try { userSave = await this.model.create(user); } catch (e) { return this.resErr(res, e); }
    const mailbody = `<h1>Welcome ${userSave.name
    } to Web Jam Apps.</h1><p>Click this <a style="color:blue; text-decoration:underline; cursor:pointer; cursor:hand" `
      + `href="${process.env.frontURL}/userutil/?email=${userSave.email}">link</a>, then enter the following code to verify your email:`
      + `<br><br><strong>${randomNumba}</strong></p>`;
    this.authUtils.sendGridEmail(mailbody, userSave.email, 'Verify Your Email Address');
    userSave.password = '';
    return res.status(201).json(userSave);
  }

  async signup(req: any, res: any) {
    let existingUser;
    const randomNumba = this.authUtils.generateCode(99999, 10000);
    const user = {
      name: req.body.name,
      verifiedEmail: false,
      email: req.body.email,
      password: req.body.password,
      isPswdReset: false,
      resetCode: randomNumba,
    };
    const validData = this.model.validateSignup ? this.model.validateSignup(user) : /* istanbul ignore next */'';
    if (validData !== '') return res.status(400).json({ message: validData });
    try { existingUser = await this.model.findOne({ email: req.body.email }); } catch (e) { return this.resErr(res, e); }
    if (existingUser && existingUser.verifiedEmail) {
      return res.status(409).json({ message: 'This email address is already registered' });
    }
    if (existingUser && !existingUser.verifiedEmail) {
      try { await this.model.findByIdAndRemove(existingUser._id); } catch (e) { return this.resErr(res, e); }
    }
    return this.finishSignup(res, user, randomNumba);
  }

  async google(req: any, res: any) {
    debug(req.body);
    let newUser, existingUser, profile;
    try { profile = await this.authGoogle.authenticate(req); } catch (e) { debug(e.message); return this.resErr(res, e); }
    // Step 3. Create a new user account or return an existing one.
    const update: any = {};
    update.password = '';
    update.name = profile.names[0].displayName; // force the name of the user to be the name from google account
    update.verifiedEmail = true;
    try { existingUser = await this.model.findOneAndUpdate({ email: profile.emailAddresses[0].value }, update); } catch (e) {
      return this.resErr(res, e);
    }
    if (existingUser) return res.status(200).json({ email: existingUser.email, token: this.authUtils.createJWT(existingUser) });
    const user: any = {};
    user.name = profile.names[0].displayName;
    user.email = profile.emailAddresses[0].value;
    user.isOhafUser = req.body.isOhafUser;
    user.verifiedEmail = true;
    try { newUser = await this.model.create(user); } catch (e) { return this.resErr(res, e); }
    newUser.password = '';
    return res.status(201).json({ email: newUser.email, token: this.authUtils.createJWT(newUser) });
  }
}
export default new UserController(userModel);

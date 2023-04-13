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
    try {
      const user = await this.model.findOne({ email: req.body.email });
      if (!user || !user._id) res.status(400).json({ message: 'wrong email' });
      else {
        user.password = '';
        res.status(200).json(user); 
      }
    } catch (e) { this.resErr(res, e as Error); }
  }

  // async finishLogin(res: Response, isPW: boolean, user: any) {
  //   let loginUser;
  //   const updateData: any = {};
  //   if (!isPW) return res.status(401).json({ message: 'Wrong password' });
  //   updateData.isPswdReset = false;
  //   updateData.resetCode = '';
  //   updateData.changeemail = '';
  //   try { loginUser = await this.model.findByIdAndUpdate(user._id, updateData); } catch (e) { return this.resErr(res, e as Error); }
  //   loginUser.password = '';
  //   const userToken = { token: this.authUtils.createJWT(loginUser), email: loginUser.email };
  //   return res.status(200).json(userToken);
  // }

  // async login(req: any, res: any) {
  //   let user, fourOone = '', isPW;
  //   const reqUserEmail = this.authUtils.setIfExists(req.body.email);
  //   const myPassword = this.authUtils.setIfExists(req.body.password);
  //   if (reqUserEmail === '' || myPassword === '') return res.status(400).json({ message: 'email and password are required' });
  //   try { user = await this.model.findOne({ email: reqUserEmail }); } catch (e) { return this.resErr(res, e as Error); }
  //   if (user === undefined || user === null || user._id === undefined || user._id === null) {
  //     fourOone = 'Wrong email address';
  //   } else if (user.password === '' || user.password === null || user.password === undefined) {
  //     fourOone = 'Please reset your password';
  //   } else if (!user.verifiedEmail) fourOone = '<a href="/userutil">Verify</a> your email';
  //   if (fourOone !== '') return res.status(401).json({ message: fourOone });
  //   try {
  //     isPW = this.model.comparePassword ? await this.model.comparePassword(req.body.password, user.password) : /* istanbul ignore next */false;
  //   } catch (e) { return this.resErr(res, e as Error); }
  //   return this.finishLogin(res, isPW, user);
  // }

  async handleNewUser(name:string, email:string, req: Request, res: Response) {
    const user: any = {};
    user.name = name;
    user.email = email;
    user.verifiedEmail = true;
    const newUser = await this.model.create(user);
    newUser.password = '';
    res.status(201).json({ email: newUser.email, token: this.authUtils.createJWT(newUser) });
  }

  async google(req: Request, res: Response) {
    debug(req.body);
    try {
      const { names, emailAddresses } = await this.authGoogle.authenticate(req);
      const name = names[0].displayName;
      const email = emailAddresses[0].value;
      // Step 3. Create a new user account or return an existing one.
      const update: any = {};
      update.password = '';
      update.name = name; // force the name of the user to be the name from google account
      update.verifiedEmail = true;
      const existingUser = await this.model.findOneAndUpdate({ email }, update);
      if (existingUser) {
        res.status(200).json({ email: existingUser.email, token: this.authUtils.createJWT(existingUser) });
      } else await this.handleNewUser(name, email, req, res);
    } catch (e) {
      this.resErr(res, e as Error);
    }
  }
}
export default new UserController(userModel);

import { Request, Response } from 'express';
import Debug from 'debug';
import Controller from '../../lib/controller';
import userModel from './user-facade';
import authGoogle from '../../auth/google';
import { Icontroller } from '../../lib/routeUtils';

const debug = Debug('web-jam-back:user-controller');

interface UserHandler {
  arg1: string;
  arg2: string;
  verified: boolean;
}

class UserController extends Controller {
  authGoogle: typeof authGoogle;

  constructor(uModel: typeof userModel) {
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

  async handleNewUser(name:string, email:string, req: Request, res: Response) {
    const user: UserHandler = { arg1: name, arg2: email, verified: true };
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
      const update: UserHandler = { arg1: '', arg2: name, verified: true };
      const existingUser = await this.model.findOneAndUpdate({ email }, update);
      if (existingUser) {
        res.status(200).json({ email: existingUser.email, token: this.authUtils.createJWT(existingUser) });
      } else await this.handleNewUser(name, email, req, res);
    } catch (e) {
      this.resErr(res, e as Error);
    }
  }
}
export default new UserController(userModel) as unknown as Icontroller;

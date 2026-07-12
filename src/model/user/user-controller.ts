/* eslint-disable @typescript-eslint/no-useless-constructor */
import { Request, Response } from 'express';
import Debug from 'debug';
import authGoogle from '#src/auth/google.js';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import { artistGrantForEmail } from '#src/lib/artist.js';
import userModel from './user-facade.js';

const debug = Debug('web-jam-back:user-controller');

interface UserHandler extends Record<string, unknown> {
  arg1: string;
  arg2: string;
  verified: boolean;
}

// Login-time role/artist grant for a configured artist-scoped admin (#885), e.g.
// Tim. Spread onto the created/updated user doc so the account gets `userType`
// and `artist` set. Empty for everyone else, leaving Josh's Developer role and
// all ordinary users untouched.
function grantFor(email: string): { userType: string; artist: string } | Record<string, never> {
  return artistGrantForEmail(email) || {};
}

class UserController extends Controller {
  constructor(uModel: typeof userModel) {
    super(uModel);
  }

  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  async findByEmail(req: Request, res: Response) {
    try {
      const user = await this.model.findOne({ email: req.body?.email });
      if (!user || !user._id) res.status(400).json({ message: 'wrong email' });
      else {
        user.password = '';
        res.status(200).json(user); 
      }
    } catch (e) { this.resErr(res, e as Error); }
  }

  async handleNewUser(name:string, email:string, req: Request, res: Response) {
    // Persist the real schema fields (name/email) plus any artist-scoped admin grant.
    const user = { name, email, verifiedEmail: true, ...grantFor(email) };
    const newUser = await this.model.create(user);
    newUser.password = '';
    return res.status(201).json({ email: newUser.email, token: this.authUtils.createJWT(newUser as unknown as { _id: string }) });
  }

  async google(req: Request, res: Response) {
    debug(req.body);
    try {
      const { names, emailAddresses } = await authGoogle.authenticate(req);
      const name = names[0].displayName;
      const email = emailAddresses[0].value;
      // Step 3. Create a new user account or return an existing one. A returning
      // artist-scoped admin has their grant (userType/artist) refreshed from config.
      const update: UserHandler = {
        arg1: '', arg2: name, verified: true, ...grantFor(email),
      };
      const existingUser = await this.model.findOneAndUpdate({ email }, update);
      if (existingUser) {
        return res.status(200).json({ email: existingUser.email, token: this.authUtils.createJWT(existingUser as unknown as { _id: string }) });
      } return await this.handleNewUser(name, email, req, res);
    } catch (e) {
      return this.resErr(res, e as Error);
    }
  }
}
export default new UserController(userModel) as unknown as Icontroller;

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

// ensureAuthenticated sets req.user (the caller's id) and req.userType (their role).
type CallerRequest = Request & { user?: string; userType?: string };

// Roles that may read any user record or look one up by email (web-jam-back#1110).
// Everyone else may only read their own record; all edits and deletes go through
// /admin/user, which enforces the role-grant rules.
const USER_ADMIN_ROLES = ['JaM-admin', 'Developer'];

function isUserAdmin(req: CallerRequest): boolean {
  return USER_ADMIN_ROLES.indexOf(req.userType || '') !== -1;
}

class UserController extends Controller {
  constructor(uModel: typeof userModel) {
    super(uModel);
  }

  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  // GET /user/:id — the caller's own record, or any record for a user admin.
  // An unknown caller (no id) never matches its own record, so it is refused.
  async findById(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    const caller = req as unknown as CallerRequest;
    const isOwnRecord = !!caller.user && caller.user === req.params.id;
    if (!isOwnRecord && !isUserAdmin(caller)) {
      return res.status(403).json({ message: 'not authorized to read this user' });
    }
    return super.findById(req, res);
  }

  // PUT /user/:id — refused for every caller; edits go through /admin/user.
  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/require-await
  async findByIdAndUpdate(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    return res.status(403).json({ message: 'use /admin/user' });
  }

  // DELETE /user/:id — refused for every caller; deletes go through /admin/user.
  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/require-await
  async findByIdAndDelete(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    return res.status(403).json({ message: 'use /admin/user' });
  }

  // POST /user — look a user up by email; user admins only.
  async findByEmail(req: Request, res: Response) {
    if (!isUserAdmin(req as CallerRequest)) {
      res.status(403).json({ message: 'not authorized to look up users' });
      return;
    }
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

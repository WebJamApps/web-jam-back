import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import userModel from '../user/user-facade.js';
import { validatePrivileges } from '../../auth/capabilities.js';
import { canGrantRole } from '../../auth/roleGrants.js';

// ensureAuthenticated populates req.userType with the acting admin's role.
type ActingRequest = Request & { userType?: string };

class AdminUserController extends Controller {
  constructor(uModel: typeof userModel) {
    super(uModel);
  }

  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  // Validate + authorize a role (userType) change from oldRole -> newRole made
  // by an admin whose own role is granterRole. Returns an { status, message }
  // error to send back, or null when allowed.
  // - Unchanged role is a no-op (so privilege-only edits that resend the same
  //   role are never blocked).
  // - Assigning a role: it must be a known role AND the granter must be allowed
  //   to grant it.
  // - Removing a role: the granter must be allowed to grant (i.e. administer)
  //   the role being taken away.
  roleTransitionError(
    granterRole: string | undefined,
    oldRole: string | undefined,
    newRole: string | undefined,
  ): { status: number; message: string } | null {
    const from = oldRole || '';
    const to = newRole || '';
    if (from === to) return null;
    if (to && this.userRoles.indexOf(to) === -1) {
      return { status: 400, message: 'userType not valid' };
    }
    if (to && !canGrantRole(granterRole, to)) {
      return { status: 403, message: `your role does not permit granting '${to}'` };
    }
    if (from && !canGrantRole(granterRole, from)) {
      return { status: 403, message: `your role does not permit removing '${from}'` };
    }
    return null;
  }

  async create(req: Request, res: Response): Promise<unknown> {
    const { body } = req;
    delete body._id;
    if (body.privileges !== undefined) {
      const result = validatePrivileges(body.privileges);
      if (!result.ok) return res.status(400).json({ message: result.message });
      body.privileges = result.privileges;
    }
    const roleErr = this.roleTransitionError((req as ActingRequest).userType, undefined, body.userType);
    if (roleErr) return res.status(roleErr.status).json({ message: roleErr.message });
    if (!body.name) return res.status(400).json({ message: 'Name is required' });
    if (!body.email) return res.status(400).json({ message: 'Email is required' });
    let doc;
    try { doc = await this.model.create(body); } catch (e) { return this.resErr(res, e as Error); }
    return res.status(201).json(doc);
  }

  async findByIdAndUpdate(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Update id is invalid' });
    }
    if (req.body.privileges !== undefined) {
      const result = validatePrivileges(req.body.privileges);
      if (!result.ok) return res.status(400).json({ message: result.message });
      req.body.privileges = result.privileges;
    }
    if ('userType' in req.body) {
      let existing;
      try { existing = await this.model.findById(req.params.id); } catch (e) { return this.resErr(res, e as Error); }
      const existingRole = (existing as { userType?: string } | null)?.userType;
      const roleErr = this.roleTransitionError((req as ActingRequest).userType, existingRole, req.body.userType);
      if (roleErr) return res.status(roleErr.status).json({ message: roleErr.message });
    }
    return this.contFBIandU(req, res);
  }

  async mintToken(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'id is invalid' });
    }
    let user;
    try { user = await this.model.findById(req.params.id); } catch (e) { return this.resErr(res, e as Error); }
    if (!user) return res.status(400).json({ message: 'user not found' });
    const token = this.authUtils.createServiceJWT(user as unknown as { _id: string });
    return res.status(200).json({ token });
  }
}

export default new AdminUserController(userModel) as unknown as Icontroller;

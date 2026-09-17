import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import userModel from '../user/user-facade.js';
import { AI_AGENT_ROLE, isAiAgentAccount, validatePrivileges } from '../../auth/capabilities.js';
import { canGrantRole } from '../../auth/roleGrants.js';

// ensureAuthenticated populates req.userType with the acting admin's role.
type ActingRequest = Request & { userType?: string };

const USER_STATUS_OPTIONS = ['human', 'ai-agent'];
// Only the AI-agent bot role (AI_AGENT_ROLE) may be marked ai-agent.

type AccessFields = { userType?: string; userStatus?: string; privileges?: string[] };
type HttpError = { status: number; message: string } | null;

// An AI-agent account may never hold outreach:approve (web-jam-back#1109).
// `account` is the record as it will be AFTER the write.
function agentApproveError(account: AccessFields): HttpError {
  if (isAiAgentAccount(account) && (account.privileges || []).indexOf('outreach:approve') !== -1) {
    return { status: 400, message: 'outreach:approve cannot be granted to an AI-agent account' };
  }
  return null;
}

// Update bodies are plain field values only. A `$` operator (e.g. $push on
// privileges) or a dotted path would reach Mongo without passing the privilege,
// role and status checks below.
function operatorKeyError(body: Record<string, unknown>): HttpError {
  if (Object.keys(body).some((k) => k.startsWith('$') || k.includes('.'))) {
    return { status: 400, message: 'update operators and dotted paths are not allowed' };
  }
  return null;
}

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

  // Validate a userStatus (Type) value and enforce that 'ai-agent' is only
  // allowed when the resulting role is the AI-agent bot role. resultingRole is
  // the userType the record will have after this update. Returns an error to
  // send back, or null when allowed.
  userStatusError( // eslint-disable-line class-methods-use-this
    newStatus: string | undefined,
    resultingRole: string | undefined,
  ): { status: number; message: string } | null {
    if (newStatus === undefined || newStatus === '') return null;
    if (USER_STATUS_OPTIONS.indexOf(newStatus) === -1) {
      return { status: 400, message: 'userStatus not valid' };
    }
    if (newStatus === 'ai-agent' && resultingRole !== AI_AGENT_ROLE) {
      return { status: 400, message: `userStatus 'ai-agent' requires the '${AI_AGENT_ROLE}' role` };
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
    const statusErr = this.userStatusError(body.userStatus, body.userType);
    if (statusErr) return res.status(statusErr.status).json({ message: statusErr.message });
    const approveErr = agentApproveError(body);
    if (approveErr) return res.status(approveErr.status).json({ message: approveErr.message });
    if (!body.name) return res.status(400).json({ message: 'Name is required' });
    if (!body.email) return res.status(400).json({ message: 'Email is required' });
    let doc;
    try { doc = await this.model.create(body); } catch (e) { return this.resErr(res, e as Error); }
    return res.status(201).json(doc);
  }

  // Role, status and agent-approve checks for an update that touches access
  // fields, judged against `stored` (the record before the write).
  accessUpdateError(req: Request<{ id: string }>, stored: AccessFields): HttpError {
    const { body } = req;
    if ('userType' in body) {
      const roleErr = this.roleTransitionError((req as unknown as ActingRequest).userType, stored.userType, body.userType);
      if (roleErr) return roleErr;
    }
    const resultingRole = 'userType' in body ? body.userType : stored.userType;
    if ('userStatus' in body) {
      const statusErr = this.userStatusError(body.userStatus, resultingRole);
      if (statusErr) return statusErr;
    }
    return agentApproveError({
      userType: resultingRole,
      userStatus: 'userStatus' in body ? body.userStatus : stored.userStatus,
      privileges: 'privileges' in body ? body.privileges : stored.privileges,
    });
  }

  async findByIdAndUpdate(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    if (!req.params.id || !mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Update id is invalid' });
    }
    const opErr = operatorKeyError(req.body || {});
    if (opErr) return res.status(opErr.status).json({ message: opErr.message });
    if (req.body.privileges !== undefined) {
      const result = validatePrivileges(req.body.privileges);
      if (!result.ok) return res.status(400).json({ message: result.message });
      req.body.privileges = result.privileges;
    }
    // Load the stored record whenever the write touches access fields, so every
    // check judges the record as it will be after the write. If it can't be
    // read, refuse — never write blind.
    if ('privileges' in req.body || 'userType' in req.body || 'userStatus' in req.body) {
      let existing;
      try { existing = await this.model.findById(req.params.id); } catch (e) { return this.resErr(res, e as Error); }
      if (!existing) return res.status(400).json({ message: 'Id Not Found' });
      const accessErr = this.accessUpdateError(req, existing as unknown as AccessFields);
      if (accessErr) return res.status(accessErr.status).json({ message: accessErr.message });
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

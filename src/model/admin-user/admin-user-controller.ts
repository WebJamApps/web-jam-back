import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '#src/lib/controller.js';
import { Icontroller } from '#src/lib/routeUtils.js';
import userModel from '../user/user-facade.js';
import { validatePrivileges } from '../../auth/capabilities.js';

class AdminUserController extends Controller {
  constructor(uModel: typeof userModel) {
    super(uModel);
  }

  resErr(res: Response, e: Error) { // eslint-disable-line class-methods-use-this
    return res.status(500).json({ message: e.message });
  }

  async create(req: Request, res: Response): Promise<unknown> {
    const { body } = req;
    delete body._id;
    if (body.privileges !== undefined) {
      const result = validatePrivileges(body.privileges);
      if (!result.ok) return res.status(400).json({ message: result.message });
      body.privileges = result.privileges;
    }
    if (body.userType && this.userRoles.indexOf(body.userType) === -1) {
      return res.status(400).json({ message: 'userType not valid' });
    }
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
    if (req.body.userType && this.userRoles.indexOf(req.body.userType) === -1) {
      return res.status(400).json({ message: 'userType not valid' });
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

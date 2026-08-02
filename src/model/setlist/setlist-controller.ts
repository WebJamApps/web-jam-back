import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Controller from '../../lib/controller.js';
import setlistModel from './setlist-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

class SetlistController extends Controller {
  async find(req: Request, res: Response): Promise<unknown> {
    const sortOption = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    let collection;
    try {
      collection = await (this.model as unknown as { find: (query: unknown, sort?: string) => Promise<unknown[]> }).find(req.query, sortOption);
    } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    return res.status(200).json(collection);
  }

  async findById(req: Request<{ id: string }>, res: Response): Promise<unknown> {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Find id is invalid' });
    }
    const sortOption = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    let doc;
    try {
      doc = await (this.model as unknown as { findById: (id: string, sort?: string) => Promise<unknown | null> }).findById(req.params.id, sortOption);
    } catch (e) {
      return res.status(500).json({ message: (e as Error).message });
    }
    if (!doc) {
      return res.status(400).json({ message: 'nothing found with id provided' });
    }
    return res.status(200).json(doc);
  }
}

export default new SetlistController(setlistModel) as unknown as Icontroller;

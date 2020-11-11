import mongoose from 'mongoose';
import Debug from 'debug';
import { Request, Response } from 'express';
import AuthUtils from '../auth/authUtils';

interface Imodel {
  Schema:{modelName:string},
  findOne:(...args:any)=>any;
  findOneAndUpdate:(...args:any)=>any;
  find:(...args:any)=>any;
  findById:(...args:any)=>any;
  create:(...args:any)=>any;
  findByIdAndUpdate:(...args:any)=>any;
  findByIdAndRemove:(...args:any)=>any;
  deleteMany:(...args:any)=>any;
  comparePassword?:(...args:any)=>any;
  validateSignup?:(...args:any)=>any;
}
const debug = Debug('web-jam-back:lib/controller');
let uRoles:string[] = [];
try {
  uRoles = JSON.parse(process.env.userRoles || /* istanbul ignore next */'{"roles": []}').roles;
// eslint-disable-next-line no-console
} catch (e) { /* istanbul ignore next */ console.log(e.message); }
class Controller {
  model: Imodel;

  authUtils: typeof AuthUtils;

  userRoles: string[];

  constructor(model: Imodel) {
    this.model = model;
    this.authUtils = AuthUtils;
    this.userRoles = uRoles;
  }

  async findOne(req: Request, res: Response): Promise<unknown> {
    let book;
    try {
      book = await this.model.findOne(req.query);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async findOneAndUpdate(req: Request, res: Response): Promise<unknown> {
    let updatedBook;
    try { updatedBook = await this.model.findOneAndUpdate(req.query, req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
  }

  async find(req: Request, res: Response): Promise<unknown> {
    let collection;
    try { collection = await this.model.find(req.query); } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(200).json(collection);
  }

  async findById(req: Request, res: Response): Promise<unknown> {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) { return res.status(400).json({ message: 'nothing found with id provided' }); }
    if (doc.password !== null && doc.password !== undefined) doc.password = '';
    return res.status(200).json(doc);
  }

  async create(req: Request, res: Response): Promise<unknown> {
    debug('create');
    debug(req.body);
    let doc;
    try { doc = await this.model.create(req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(201).json(doc);
  }

  async contFBIandU(req: Request, res: Response): Promise<unknown> {
    let doc;
    try { doc = await this.model.findByIdAndUpdate(req.params.id, req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    if (doc.password !== null && doc.password !== undefined) doc.password = '';
    return res.status(200).json(doc);
  }

  findByIdAndUpdate(req: Request, res: Response<unknown>): Response<unknown> | Promise<unknown> {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { return res.status(400).json({ message: 'Update id is invalid' }); }
    if (req.body.userType && this.userRoles.indexOf(req.body.userType) === -1) { return res.status(400).json({ message: 'userType not valid' }); }
    if (req.body.name === '') { return res.status(400).json({ message: 'Name is required' }); }
    return this.contFBIandU(req, res);
  }

  async findByIdAndRemove(req: Request, res: Response): Promise<unknown> {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'id is invalid' });
    let doc;
    try { doc = await this.model.findByIdAndRemove(req.params.id); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) return res.status(400).json({ message: 'Delete id is invalid' });
    debug(this.model);
    return res.status(200).json({ message: `${this.model.Schema.modelName} was deleted successfully` });
  }

  async deleteMany(req: Request, res: Response): Promise<unknown> {
    try {
      await this.model.deleteMany(req.query);
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
    return res.status(200).json({ message: `${this.model.Schema.modelName} deleteMany was successful` });
  }

  async deleteAllDocs(): Promise<Error> {
    debug('deleteAllDocs');
    let result: Error;
    try { result = await this.model.deleteMany({}); } catch (e) { return Promise.reject(e); }
    return result;
  }

  async createDocs(body: Record<string, unknown>[]): Promise<Error> {
    let result: Error;
    try { result = await this.model.create(body); } catch (e) { return Promise.reject(e); }
    return result;
  }
}
export default Controller;

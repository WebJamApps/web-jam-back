import mongoose from 'mongoose';
import Debug from 'debug';
import AuthUtils from '../auth/authUtils';

const debug = Debug('web-jam-back:lib/controller');

class Controller {
  model: any;

  authUtils: any;

  userRoles: any;

  constructor(model) {
    this.model = model;
    this.authUtils = AuthUtils;
    this.userRoles = process.env.userRoles;
  }

  async findOne(req, res) {
    let book;
    try {
      book = await this.model.findOne(req.query);
    } catch (e) { return res.status(500).json({ message: e.message }); }
    if (book === undefined || book === null || book._id === null || book._id === undefined) {
      return res.status(400).json({ message: 'invalid request' });
    }
    return res.status(200).json(book);
  }

  async findOneAndUpdate(req, res) {
    let updatedBook;
    try { updatedBook = await this.model.findOneAndUpdate(req.query, req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (updatedBook === null || updatedBook === undefined) return res.status(400).json({ message: 'invalid request' });
    return res.status(200).json(updatedBook);
  }

  async find(req, res) {
    let collection;
    try { collection = await this.model.find(req.query); } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(200).json(collection);
  }

  async findById(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Find id is invalid' });
    let doc;
    try { doc = await this.model.findById(req.params.id); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) { return res.status(400).json({ message: 'nothing found with id provided' }); }
    if (doc.password !== null && doc.password !== undefined) doc.password = '';
    return res.status(200).json(doc);
  }

  async create(req, res) {
    debug('create');
    debug(req.body);
    let doc;
    try { doc = await this.model.create(req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    return res.status(201).json(doc);
  }

  async contFBIandU(req, res) {
    let doc;
    try { doc = await this.model.findByIdAndUpdate(req.params.id, req.body); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) return res.status(400).json({ message: 'Id Not Found' });
    if (doc.password !== null && doc.password !== undefined) doc.password = '';
    return res.status(200).json(doc);
  }

  findByIdAndUpdate(req, res) {
    const uR = JSON.parse(this.userRoles);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Update id is invalid' });
    if (req.body.userType && uR.roles.indexOf(req.body.userType) === -1) return res.status(400).json({ message: 'userType not valid' });
    if (req.body.name === '') return res.status(400).json({ message: 'Name is required' });
    return this.contFBIandU(req, res);
  }

  async findByIdAndRemove(req, res) {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'id is invalid' });
    let doc;
    try { doc = await this.model.findByIdAndRemove(req.params.id); } catch (e) { return res.status(500).json({ message: e.message }); }
    if (!doc) return res.status(400).json({ message: 'Delete id is invalid' });
    return res.status(200).json({ message: `${this.model.Schema.modelName} was deleted successfully` });
  }

  deleteMany(req, res) {
    return this.model.deleteMany(req.query)
      .then(() => res.status(200).json({ message: `${this.model.Schema.modelName} deleteMany was successful` }))
      .catch((e) => res.status(500).json({ message: e.message }));
  }
}

export default Controller;
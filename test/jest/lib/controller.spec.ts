/* eslint-disable @typescript-eslint/ban-ts-comment */
import mongoose from 'mongoose';
import Controller from '../../../src/lib/controller';

describe('lib controller', () => {
  const goodId = mongoose.Types.ObjectId();
  let c, r;
  const model = {
    findOne: () => Promise.reject(new Error('bad')),
    findOneAndUpdate: () => Promise.reject(new Error('bad')),
    find: () => Promise.reject(new Error('bad')),
    findById: () => Promise.reject(new Error('bad')),
    create: () => Promise.reject(new Error('bad')),
    findByIdAndUpdate: () => Promise.reject(new Error('bad')),
    findByIdAndRemove: () => Promise.reject(new Error('bad')),
  };
  const req:any = { query: '', body: {}, params: {} };
  const res = { status: () => ({ json: (obj) => Promise.resolve(obj) }) };
  it('it catches error on findOne', async () => {
    c = new Controller(model);
    r = await c.findOne(req, res);
    expect(r.message).toBe('bad');
  });
  it('it catches error on findOneAndUpdate', async () => {
    c = new Controller(model);
    r = await c.findOneAndUpdate(req, res);
    expect(r.message).toBe('bad');
  });
  it('it catches error on find', async () => {
    c = new Controller(model);
    r = await c.find(req, res);
    expect(r.message).toBe('bad');
  });
  it('it returns 400 on findById with bad id', async () => {
    c = new Controller(model);
    r = await c.findById(req, res);
    expect(r.message).toBe('Find id is invalid');
  });
  it('it returns 500 on findById', async () => {
    req.params.id = goodId;
    c = new Controller(model);
    r = await c.findById(req, res);
    expect(r.message).toBe('bad');
  });
  it('it returns 400 on findById when no doc is found', async () => {
    req.params.id = goodId;
    // @ts-ignore
    model.findById = () => Promise.resolve();
    c = new Controller(model);
    r = await c.findById(req, res);
    expect(r.message).toBe('nothing found with id provided');
  });
  it('it does not return the password from findById', async () => {
    req.params.id = goodId;
    // @ts-ignore
    model.findById = () => Promise.resolve({ password: 'password' });
    c = new Controller(model);
    r = await c.findById(req, res);
    expect(r.password).toBe('');
  });
  it('it returns 500 on create', async () => {
    c = new Controller(model);
    r = await c.create(req, res);
    expect(r.message).toBe('bad');
  });
  it('it returns 400 on findByIdAndUpdate with bad id', async () => {
    req.params.id = 'bad';
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.message).toBe('Update id is invalid');
  });
  it('it returns 400 on findByIdAndUpdate with bad userType', async () => {
    req.params.id = goodId;
    req.body.userType = 'bad';
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.message).toBe('userType not valid');
  });
  it('it returns 400 if name is empty string', async () => {
    req.params.id = goodId;
    req.body = { name: '' };
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.message).toBe('Name is required');
  });
  it('it returns 500 from findByIdAndUpdate', async () => {
    req.params.id = goodId;
    req.body = { };
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.message).toBe('bad');
  });
  it('it returns 400 from findByIdAndUpdate when nothing is found', async () => {
    req.params.id = goodId;
    req.body = { };
    // @ts-ignore
    model.findByIdAndUpdate = () => Promise.resolve();
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.message).toBe('Id Not Found');
  });
  it('findByIdAndUpdate does not return the password', async () => {
    req.params.id = goodId;
    req.body = { };
    // @ts-ignore
    model.findByIdAndUpdate = () => Promise.resolve({ password: 'password' });
    c = new Controller(model);
    r = await c.findByIdAndUpdate(req, res);
    expect(r.password).toBe('');
  });
  it('it returns 400 on findByIdAndRemove with bad id', async () => {
    req.params.id = 'bad';
    c = new Controller(model);
    r = await c.findByIdAndRemove(req, res);
    expect(r.message).toBe('id is invalid');
  });
  it('it returns 500 on findByIdAndRemove', async () => {
    req.params.id = goodId;
    c = new Controller(model);
    r = await c.findByIdAndRemove(req, res);
    expect(r.message).toBe('bad');
  });
  it('it returns 400 on findByIdAndRemove when nothing is found', async () => {
    req.params.id = goodId;
    // @ts-ignore
    model.findByIdAndRemove = () => Promise.resolve();
    c = new Controller(model);
    r = await c.findByIdAndRemove(req, res);
    expect(r.message).toBe('Delete id is invalid');
  });
  it('it returns 500 on deleteMany', async () => {
    // @ts-ignore
    model.deleteMany = () => Promise.reject(new Error('bad'));
    c = new Controller(model);
    r = await c.deleteMany(req, res);
    expect(r.message).toBe('bad');
  });
});

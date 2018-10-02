const request = require('supertest');
const server = require('../../index');
const uc = require('../../model/user/user-controller');
const user = require('../../model/user/user-schema');

const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];

describe.only('User Controller', () => {
  beforeEach(async () => {
    await user.deleteMany({});
  });
  afterAll(async () => {
    await user.deleteMany({});
  });
  it('validates email', async () => {
    uc.model = { findOneAndUpdate() { return Promise.resolve({ name: 'tester' }); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body: { email: 'yo@yo.com', resetCode: '1234' } }, res);
    expect(cb.name).toBe('tester');
  });
  it('updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
      console.log(31);
      console.log(cb.body);
      expect(cb.status).toBe(200);
      expect(cb.email).toBe('j@jb.com');
    } catch (e) { throw e; }
  });
  it('catches error on validates email', async () => {
    uc.model = { findOneAndUpdate() { return Promise.reject(new Error('bad')); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body: { email: 'yo@yo.com', resetCode: '1234' } }, res);
    expect(cb.message).toBe('bad');
  });
  it('returns error on validates email when user is not found', async () => {
    uc.model = { findOneAndUpdate() { return Promise.resolve(null); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body: { email: 'yo@yo.com', resetCode: '1234' } }, res);
    expect(cb.message).toBe('incorrect email or code');
  });
});

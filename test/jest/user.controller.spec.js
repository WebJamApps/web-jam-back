const request = require('supertest');
const EventEmitter = require('events');
const sinon = require('sinon');
const bcrypt = require('bcryptjs');
const server = require('../../index');
const user = require('../../model/user/user-facade');
const google = require('../../auth/google');
const controller = require('../../model/user/user-controller');
require('sinon-mongoose');

const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];

describe('User Controller', () => {
  beforeAll((done) => {
    EventEmitter.defaultMaxListeners = 30;
    done();
  });
  beforeEach(async () => {
    await user.deleteMany({});
  });
  afterAll(async () => {
    EventEmitter.defaultMaxListeners = 12;
    await user.deleteMany({});
  });
  it('validates email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
    });
    const cb = await request(server)
      .put('/user/auth/validateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', email: 'yo@yo.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.resetCode).toBe('');
  });
  it('returns findOneAndUpdate error when validates email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
    });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/validateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', email: 'yo@yo.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('returns findOneAndUpdate error when validates email and user is not found', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
    });
    const cb = await request(server)
      .put('/user/auth/validateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', email: 'boo@yo.com' });
    expect(cb.status).toBe(400);
  });
  it('updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const cb = await request(server)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.email).toBe('j@jb.com');
  });
  it('returns error when updates the email if user reset code does not match', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const cb = await request(server)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '456', changeemail: 'j@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  it('returns error when updates the email if user changeemail does not match', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const cb = await request(server)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', changeemail: 'g@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  it('returns findOneAndUpdate error when updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(500);
    expect(cb.body.message).toBe('bad');
    uMock.restore();
  });
  it('resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(server)
      .put('/user/auth/resetpswd')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.email).toBe('old@wold.com');
  });
  it('returns gensalt error on password reset', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true, password: 'oldoldoldold',
    });
    const bMock = sinon.mock(bcrypt);
    bMock.expects('genSalt').yields(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/pswdreset')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', password: 'superSecure' });
    expect(cb.status).toBe(500);
    bMock.restore();
  });
  it('returns hash error on password reset', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true, password: 'oldoldoldold',
    });
    const bMock = sinon.mock(bcrypt);
    bMock.expects('hash').yields(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/pswdreset')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', password: 'superSecure' });
    expect(cb.status).toBe(500);
    bMock.restore();
  });
  it('returns 400 error on resets the password when user email is not verified', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: false,
    });
    const cb = await request(server)
      .put('/user/auth/resetpswd')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  it('returns findOneAndUpdate error on resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/resetpswd')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.success).toBe(true);
  });
  it('returns error from comparing passwords on login', async () => {
    await user.create({
      name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true,
    });
    const bMock = sinon.mock(bcrypt);
    bMock.expects('compare').yields(new Error('bad'));
    const cb = await request(server)
      .post('/user/auth/login')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
    expect(cb.status).toBe(500);
    bMock.restore();
  });
  it('returns findByIdAndUpdate error from login', async () => {
    await user.create({
      name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true,
    });
    const bMock = sinon.mock(user);
    bMock.expects('findByIdAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .post('/user/auth/login')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
    expect(cb.status).toBe(500);
    bMock.restore();
  });
  it('returns bad email syntax error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'booya' });
    expect(cb.status).toBe(400);
  });
  it('returns findOne error for changeemail when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const uMock = sinon.mock(user);
    uMock.expects('findOne').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('returns find error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const uMock = sinon.mock(user);
    uMock.expects('find').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('returns error if user is not found when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const uMock = sinon.mock(user);
    uMock.expects('find').resolves();
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('returns findOneAndUpdate error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(500);
    uMock.restore();
  });
  it('authenticates with google', async () => {
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
    const cb = await request(server)
      .post('/user/auth/google')
      .set({ origin: allowedUrl })
      .send({ });
    expect(cb.status).toBe(201);
    gMock.restore();
  });
  it('returns google api error when authenticates with google', async () => {
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').rejects(new Error('bad'));
    const cb = await request(server)
      .post('/user/auth/google')
      .set({ origin: allowedUrl })
      .send({ });
    expect(cb.status).toBe(500);
    gMock.restore();
  });
  it('returns findOneAndUpdate error when authenticates with google', async () => {
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
    const cb = await request(server)
      .post('/user/auth/google')
      .set({ origin: allowedUrl })
      .send({ });
    expect(cb.status).toBe(500);
    uMock.restore();
    gMock.restore();
  });
  it('authenticates with google for an existing user', async () => {
    await user.create({ name: 'Josh', email: 'j@js.com' });
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
    const cb = await request(server)
      .post('/user/auth/google')
      .set({ origin: allowedUrl })
      .send({ });
    expect(cb.status).toBe(200);
    gMock.restore();
  });
  it('finds the changeemail that already exists', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve({}));
    try { await controller.validateChangeEmail({ body: { email: 'yo@yo.com' } }); } catch (e) {
      expect(e.message).toBe('Email address already exists');
    }
  });
  it('catches a error on create new user after google authenticate', async () => {
    google.authenticate = jest.fn(() => Promise.resolve({ emailAddresses: [{ value: 'jb@yo.com' }], names: [{ displayName: 'jb' }] }));
    controller.model.findOneAndUpdate = jest.fn(() => Promise.resolve());
    const resStub = { status: () => ({ json: () => Promise.resolve(false) }) };
    controller.model.findOne = jest.fn(() => Promise.resolve({}));
    controller.model.create = jest.fn(() => Promise.reject(new Error('bad')));
    const result = await controller.google({ body: { email: 'yo@yo.com' } }, resStub);
    expect(result).toBe(false);
  });
});

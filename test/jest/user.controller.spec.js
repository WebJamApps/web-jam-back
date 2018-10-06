const request = require('supertest');
const EventEmitter = require('events');
const sinon = require('sinon');
const bcrypt = require('bcryptjs');
const server = require('../../index');
const user = require('../../model/user/user-schema');
const google = require('../../auth/google');
require('sinon-mongoose');

const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];

describe('User Controller', () => {
  beforeEach(async () => {
    await user.deleteMany({});
  });
  afterAll(async () => {
    EventEmitter.defaultMaxListeners = 10;
    await user.deleteMany({});
  });
  it('validates email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/validateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', email: 'yo@yo.com' });
      expect(cb.status).toBe(200);
      expect(cb.body.resetCode).toBe('');
    } catch (e) { throw e; }
  });
  it('returns findOneAndUpdate error when validates email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123'
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/validateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', email: 'yo@yo.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findOneAndUpdate error when validates email and user is not found', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/validateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', email: 'boo@yo.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(200);
      expect(cb.body.email).toBe('j@jb.com');
    } catch (e) { throw e; }
  });
  it('returns email syntax error when updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'loser', email: 'old@wold.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('returns findOne error when updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(500);
      expect(cb.body.message).toBe('bad');
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findOne error when updates the email if user does not exist', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOne').chain('exec').resolves();
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns error when updates the email if user reset code does not match', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '456', changeemail: 'j@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('returns error when updates the email if user changeemail does not match', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'g@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('returns findOneAndUpdate error when updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123'
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/updateemail')
        .set({ origin: allowedUrl })
        .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
      expect(cb.status).toBe(500);
      expect(cb.body.message).toBe('bad');
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/resetpswd')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com' });
      expect(cb.status).toBe(200);
      expect(cb.body.email).toBe('old@wold.com');
    } catch (e) { throw e; }
  });
  it('returns findOne error on resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/resetpswd')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com' });
      expect(cb.status).toBe(500);
      expect(cb.body.message).toBe('bad');
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findOne error on resets the password when no user is found', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOne').chain('exec').resolves();
    try {
      cb = await request(server)
        .put('/user/auth/resetpswd')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns 401 error on resets the password when user email is not verified', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: false
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/resetpswd')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com' });
      expect(cb.status).toBe(401);
    } catch (e) { throw e; }
  });
  it('returns findOneAndUpdate error on resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/resetpswd')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(200);
      expect(cb.body.success).toBe(true);
    } catch (e) { throw e; }
  });
  it('returns error from comparing passwords on login', async () => {
    await user.create({
      name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const bMock = sinon.mock(bcrypt);
    bMock.expects('compare').yields(new Error('bad'));
    try {
      cb = await request(server)
        .post('/user/auth/login')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    bMock.restore();
  });
  it('returns findByIdAndUpdate error from login', async () => {
    await user.create({
      name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const bMock = sinon.mock(user);
    bMock.expects('findByIdAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .post('/user/auth/login')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    bMock.restore();
  });
  it('returns bad email syntax error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'booya' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('returns findOne error for changeemail when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns error for changeemail if email already exists when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    await user.create({
      name: 'Jay Beetle', email: 'j@jb.com', verifiedEmail: true
    });
    let cb;
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
  });
  it('returns find error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('find').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns error if user is not found when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('find').chain('exec').resolves();
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findOneAndUpdate error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true
    });
    let cb;
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .put('/user/auth/changeemail')
        .set({ origin: allowedUrl })
        .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('authenticates with google', async () => {
    let cb;
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ name: 'Josh', email: 'j@js.com' });
    try {
      cb = await request(server)
        .post('/user/auth/google')
        .set({ origin: allowedUrl })
        .send({ });
      expect(cb.status).toBe(201);
    } catch (e) { throw e; }
    gMock.restore();
  });
  it('returns db.create error when authenticates with google', async () => {
    let cb;
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ name: 'Josh', email: 'j@js.com' });
    const uMock = sinon.mock(user);
    uMock.expects('create').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .post('/user/auth/google')
        .set({ origin: allowedUrl })
        .send({ });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    gMock.restore();
    uMock.restore();
  });
  it('returns google api error when authenticates with google', async () => {
    let cb;
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .post('/user/auth/google')
        .set({ origin: allowedUrl })
        .send({ });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    gMock.restore();
  });
  it('returns findOneAndUpdate error when authenticates with google', async () => {
    let cb;
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ name: 'Josh', email: 'j@js.com' });
    const uMock = sinon.mock(user);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    try {
      cb = await request(server)
        .post('/user/auth/google')
        .set({ origin: allowedUrl })
        .send({ });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    uMock.restore();
    gMock.restore();
  });
  it('authenticates with google for an existing user', async () => {
    await user.create({ name: 'Josh', email: 'j@js.com' });
    let cb;
    const gMock = sinon.mock(google);
    gMock.expects('authenticate').resolves({ name: 'Josh', email: 'j@js.com' });
    try {
      cb = await request(server)
        .post('/user/auth/google')
        .set({ origin: allowedUrl })
        .send({ });
      expect(cb.status).toBe(200);
    } catch (e) { throw e; }
    gMock.restore();
  });
});

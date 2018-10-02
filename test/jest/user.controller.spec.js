const request = require('supertest');
const sinon = require('sinon');
const server = require('../../index');
const user = require('../../model/user/user-schema');
require('sinon-mongoose');

const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];

describe.only('User Controller', () => {
  beforeEach(async () => {
    await user.deleteMany({});
  });
  afterAll(async () => {
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
});

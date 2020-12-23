/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import app from '../../../src/index';
import user from '../../../src/model/user/user-facade';
import google from '../../../src/auth/google';
import controller from '../../../src/model/user/user-controller';
import authUtils from '../../../src/auth/authUtils';

const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];

describe('User Router', () => {
  let r;
  const deleter:any = {};
  beforeEach(async () => {
    await user.deleteMany(deleter);
  });
  afterAll(async () => {
    await user.deleteMany(deleter);
  });
  // it('validates email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
  //   });
  //   r = await request(app)
  //     .put('/user/auth/validateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', email: 'yo@yo.com' });
  //   expect(r.status).toBe(200);
  //   expect(r.body.resetCode).toBe('');
  // });
  it('finds a user by email', async () => {
    const newUser:any = await user.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
    r = await request(app)
      .post('/user')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({ email: 'foo3@example.com' });
    expect(r.status).toBe(200);
  });  
  it('finds all users', async () => {
    await user.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
    r = await request(app)
      .get('/user');
    expect(r.status).toBe(200);
  });
  it('finds a user by id', async () => {
    const newUser:any = await user.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
    r = await request(app)
      .get(`/user/${newUser._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('updates a user', async () => {
    const newUser:any = await user.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
    r = await request(app)
      .put(`/user/${newUser._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({ name: 'foobar' });
    expect(r.status).toBe(200);
  });
  it('deletes a user', async () => {
    const newUser:any = await user.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
    r = await request(app)
      .delete(`/user/${newUser.id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.body.message).toBe('User was deleted successfully');
    expect(r.status).toBe(200);
  });
  it('allows the user to login with email', async () => {
    await user.create({
      name: 'foo', email: 'foo3@example.com', password: 'lottanumbers35555', verifiedEmail: true,
    });
    r = await request(app)
      .post('/user/auth/login')
      .send({ email: 'foo3@example.com', password: 'lottanumbers35555' });
    expect(r.status).toBe(200);
  });
  it('signs up the new user', async () => {
    r = await request(app)
      .post('/user/auth/signup')
      .send({
        email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555',
      });
    expect(r.status).toBe(201);
  });
  it('authenticates with google', async () => {
    const g: any = google;
    g.authenticate = jest.fn(() => Promise.resolve({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] }));
    r = await request(app)
      .post('/user/auth/google')
      .set({ origin: allowedUrl })
      .send({ });
    expect(r.status).toBe(201);
  });
  // it('returns findOneAndUpdate error when validates email and user is not found', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/validateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', email: 'boo@yo.com' });
  //   expect(cb.status).toBe(400);
  // });
  // it('updates the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/updateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
  //   expect(cb.status).toBe(200);
  //   expect(cb.body.email).toBe('j@jb.com');
  // });
  // it('returns error when updates the email if user reset code does not match', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/updateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '456', changeemail: 'j@jb.com', email: 'old@wold.com' });
  //   expect(cb.status).toBe(400);
  // });
  // it('returns error when updates the email if user changeemail does not match', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/updateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', changeemail: 'g@jb.com', email: 'old@wold.com' });
  //   expect(cb.status).toBe(400);
  // });
  // it('resets the password', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/resetpswd')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com' });
  //   expect(cb.status).toBe(200);
  //   expect(cb.body.email).toBe('old@wold.com');
  // });
  // it('returns 400 error on resets the password when user email is not verified', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: false,
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/resetpswd')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com' });
  //   expect(cb.status).toBe(400);
  // });
  // it('handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
  //   expect(cb.status).toBe(200);
  //   expect(cb.body.success).toBe(true);
  // });
  // it('returns bad email syntax error when handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const cb = await request(app)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'booya' });
  //   expect(cb.status).toBe(400);
  // });
  // it('finds the changeemail that already exists', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve({}));
  //   await expect(controller.validateChangeEmail({ body: { email: 'yo@yo.com' } })).rejects.toThrow('Email address already exists');
  // });
  it('catches a error on create new user after google authenticate', async () => {
    const g: any = google;
    g.authenticate = jest.fn(() => Promise.resolve({ emailAddresses: [{ value: 'jb@yo.com' }], names: [{ displayName: 'jb' }] }));
    controller.model.findOneAndUpdate = jest.fn(() => Promise.resolve());
    const resStub = { status: () => ({ json: () => Promise.resolve(false) }) };
    controller.model.findOne = jest.fn(() => Promise.resolve({}));
    controller.model.create = jest.fn(() => Promise.reject(new Error('bad')));
    const result = await controller.google({ body: { email: 'yo@yo.com' } }, resStub);
    expect(result).toBe(false);
  });
});

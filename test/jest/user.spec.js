const request = require('supertest');
const EventEmitter = require('events');
// const bcrypt = require('bcryptjs');
const app = require('../../index');
const user = require('../../model/user/user-facade');
const google = require('../../auth/google');
const controller = require('../../model/user/user-controller');

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
    const cb = await request(app)
      .put('/user/auth/validateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', email: 'yo@yo.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.resetCode).toBe('');
  });
  // it('returns findOneAndUpdate error when validates email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/validateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', email: 'yo@yo.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  it('returns findOneAndUpdate error when validates email and user is not found', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'yo@yo.com', resetCode: '123',
    });
    const cb = await request(app)
      .put('/user/auth/validateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', email: 'boo@yo.com' });
    expect(cb.status).toBe(400);
  });
  it('updates the email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const cb = await request(app)
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
    const cb = await request(app)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '456', changeemail: 'j@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  it('returns error when updates the email if user changeemail does not match', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
    });
    const cb = await request(app)
      .put('/user/auth/updateemail')
      .set({ origin: allowedUrl })
      .send({ resetCode: '123', changeemail: 'g@jb.com', email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  // it('returns findOneAndUpdate error when updates the email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', changeemail: 'j@jb.com', resetCode: '123',
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/updateemail')
  //     .set({ origin: allowedUrl })
  //     .send({ resetCode: '123', changeemail: 'j@jb.com', email: 'old@wold.com' });
  //   expect(cb.status).toBe(500);
  //   expect(cb.body.message).toBe('bad');
  //   uMock.restore();
  // });
  it('resets the password', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(app)
      .put('/user/auth/resetpswd')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.email).toBe('old@wold.com');
  });
  // it('returns gensalt error on password reset', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true, password: 'oldoldoldold',
  //   });
  //   const bMock = sinon.mock(bcrypt);
  //   bMock.expects('genSalt').yields(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/pswdreset')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', password: 'superSecure' });
  //   expect(cb.status).toBe(500);
  //   bMock.restore();
  // });
  // it('returns hash error on password reset', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true, password: 'oldoldoldold',
  //   });
  //   const bMock = sinon.mock(bcrypt);
  //   bMock.expects('hash').yields(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/pswdreset')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', password: 'superSecure' });
  //   expect(cb.status).toBe(500);
  //   bMock.restore();
  // });
  it('returns 400 error on resets the password when user email is not verified', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: false,
    });
    const cb = await request(app)
      .put('/user/auth/resetpswd')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com' });
    expect(cb.status).toBe(400);
  });
  // it('returns findOneAndUpdate error on resets the password', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/resetpswd')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  it('handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(app)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
    expect(cb.status).toBe(200);
    expect(cb.body.success).toBe(true);
  });
  // it('returns error from comparing passwords on login', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const bMock = sinon.mock(bcrypt);
  //   bMock.expects('compare').yields(new Error('bad'));
  //   const cb = await request(server)
  //     .post('/user/auth/login')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
  //   expect(cb.status).toBe(500);
  //   bMock.restore();
  // });
  // it('returns findByIdAndUpdate error from login', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', password: 'booyaaaaaaaa', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const bMock = sinon.mock(user);
  //   bMock.expects('findByIdAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .post('/user/auth/login')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', password: 'booyaaaaaaaa' });
  //   expect(cb.status).toBe(500);
  //   bMock.restore();
  // });
  it('returns bad email syntax error when handles request to change the user email', async () => {
    await user.create({
      name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
    });
    const cb = await request(app)
      .put('/user/auth/changeemail')
      .set({ origin: allowedUrl })
      .send({ email: 'old@wold.com', changeemail: 'booya' });
    expect(cb.status).toBe(400);
  });
  // it('returns findOne error for changeemail when handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOne').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  // it('returns find error when handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('find').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  // it('returns error if user is not found when handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('find').resolves();
  //   const cb = await request(server)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  // it('returns findOneAndUpdate error when handles request to change the user email', async () => {
  //   await user.create({
  //     name: 'Justin Bieber', email: 'old@wold.com', verifiedEmail: true,
  //   });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .put('/user/auth/changeemail')
  //     .set({ origin: allowedUrl })
  //     .send({ email: 'old@wold.com', changeemail: 'j@jb.com' });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  // });
  // it('authenticates with google', async () => {
  //   const gMock = sinon.mock(google);
  //   gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
  //   const cb = await request(server)
  //     .post('/user/auth/google')
  //     .set({ origin: allowedUrl })
  //     .send({ });
  //   expect(cb.status).toBe(201);
  //   gMock.restore();
  // });
  // it('returns google api error when authenticates with google', async () => {
  //   const gMock = sinon.mock(google);
  //   gMock.expects('authenticate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .post('/user/auth/google')
  //     .set({ origin: allowedUrl })
  //     .send({ });
  //   expect(cb.status).toBe(500);
  //   gMock.restore();
  // });
  // it('returns findOneAndUpdate error when authenticates with google', async () => {
  //   const gMock = sinon.mock(google);
  //   gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
  //   const uMock = sinon.mock(user);
  //   uMock.expects('findOneAndUpdate').rejects(new Error('bad'));
  //   const cb = await request(server)
  //     .post('/user/auth/google')
  //     .set({ origin: allowedUrl })
  //     .send({ });
  //   expect(cb.status).toBe(500);
  //   uMock.restore();
  //   gMock.restore();
  // });
  // it('authenticates with google for an existing user', async () => {
  //   await user.create({ name: 'Josh', email: 'j@js.com' });
  //   const gMock = sinon.mock(google);
  //   gMock.expects('authenticate').resolves({ names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] });
  //   const cb = await request(server)
  //     .post('/user/auth/google')
  //     .set({ origin: allowedUrl })
  //     .send({ });
  //   expect(cb.status).toBe(200);
  //   gMock.restore();
  // });
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
  // it('finds a user by email', async () => {
  //   await User1.deleteMany({});
  //   const User2 = new User1();
  //   User2.name = 'foo';
  //   User2.email = 'foo3@example.com';
  //   await User2.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user')
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ email: 'foo3@example.com' });
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('catches error on find a user by email', async () => {
  //   await User1.deleteMany({});
  //   const User2 = new User1();
  //   User2.name = 'foo';
  //   User2.email = 'foo3@example.com';
  //   await User2.save();
  //   const uMock = sinon.mock(User1);
  //   uMock
  //     .expects('findOne')
  //     .chain('exec')
  //     .rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user')
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ email: 'foo3@example.com' });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('returns error on find a user by email when no user is found', async () => {
  //   await User1.deleteMany({});
  //   const User2 = new User1();
  //   User2.name = 'foo';
  //   User2.email = 'foo3@example.com';
  //   await User2.save();
  //   const uMock = sinon.mock(User1);
  //   uMock
  //     .expects('findOne')
  //     .chain('exec')
  //     .resolves();
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user')
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ email: 'foo3@example.com' });
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('finds a user by id', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .get(`/user/${User._id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('finds a user by id and removes the password before returning the user', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   User.password = 'superSecure';
  //   await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .get(`/user/${User._id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
  //     expect(cb).to.have.status(200);
  //     expect(cb.body.password).to.equal('');
  //   } catch (e) { throw e; }
  // });
  // it('updates a user', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: 'foobar' });
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('updates a user and overwrites the password', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   User.password = 'superSecure';
  //   const newUser = await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: 'foobar' });
  //     expect(cb).to.have.status(200);
  //     expect(cb.body.password).to.equal('');
  //   } catch (e) { throw e; }
  // });
  // it('catches findByIdAndUpdate error', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   User.password = 'superSecure';
  //   const newUser = await User.save();
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('findByIdAndUpdate').chain('exec').rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: 'foobar' });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('prevents updating a userType that is not valid', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: 'foobar', userType: 'booya' });
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  // });
  // it('prevents updating when name is empty string', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: '', userType: 'Charity' });
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  // });
  // it('returns error on findByIdAndUpdate when none is found', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   await User1.deleteMany({});
  //   try {
  //     const cb = await chai.request(server)
  //       .put(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .send({ name: 'Bob', userType: 'Charity' });
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  // });
  // it('deletes a user', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .delete(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
  //     expect(cb.body.message).to.equal('User delete was successful');
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('returns error when deletes a user but none is found', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo';
  //   User.email = 'foo3@example.com';
  //   const newUser = await User.save();
  //   await User1.deleteMany({});
  //   try {
  //     const cb = await chai.request(server)
  //       .delete(`/user/${newUser.id}`)
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  // });
  // it('returns error on deletes a user with bogas id', async () => {
  //   await User1.deleteMany({});
  //   try {
  //     const cb = await chai.request(server)
  //       .delete('/user/bogas')
  //       .set({ origin: allowedUrl })
  //       .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
  //     expect(cb).to.have.status(400);
  //   } catch (e) { throw e; }
  // });
  // it('signs up the new user', async () => {
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({
  //         email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555',
  //       });
  //     expect(cb).to.have.status(201);
  //   } catch (e) { throw e; }
  // });
  // it('returns db.create error when signs up the new user', async () => {
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('create').rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({
  //         email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555',
  //       });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('returns findOne error when signs up the new user', async () => {
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({
  //         email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555',
  //       });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('returns findByIdAndRemove error when signs up the existing user', async () => {
  //   await User1.create({ name: 'foowee', email: 'foo3@example.com', verifiedEmail: false });
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('findByIdAndRemove').chain('exec').rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({
  //         email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555',
  //       });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('should not signup the new user if the email already exists and has been verified', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo4@example.com';
  //   User.verifiedEmail = true;
  //   await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({
  //         email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555',
  //       });
  //     expect(cb).to.have.status(409);
  //   } catch (e) { throw e; }
  // });
  // it('allows signup the existing user if the email has not been verified', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo4@example.com';
  //   User.verifiedEmail = false;
  //   await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/signup')
  //       .send({ email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555' });
  //     expect(cb).to.have.status(201);
  //   } catch (e) { throw e; }
  // });
  // it('should not signup the new user if the name, password, or email is not valid', (done) => {
  //   chai.request(server)
  //     .post('/user/auth/signup')
  //     .send({ email: 'foo4example.com', password: '00' })
  //     .end((err, res) => {
  //       expect(res).to.have.status(409);
  //       done();
  //     });
  // });
  // it('allows the user to login with email', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.verifiedEmail = true;
  //   User.resetCode = '';
  //   await User.save();
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ email: 'foo3@example.com', password: 'lottanumbers35555' });
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('returns findOne error when user login with email', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.verifiedEmail = true;
  //   User.resetCode = '';
  //   await User.save();
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
  //   try {
  //     const cb = await chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ email: 'foo3@example.com', password: 'lottanumbers35555' });
  //     expect(cb).to.have.status(500);
  //   } catch (e) { throw e; }
  //   uMock.restore();
  // });
  // it('should not allow the user to login with incorrect email', (done) => {
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '';
  //   User.save(() => {
  //     chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ password: 'lottanumbers35555', email: 'foogie@yoyo.com' })
  //       .end((err, resp) => {
  //         expect(resp).to.have.status(401);
  //         done();
  //       });
  //   });
  // });
  // it('should not allow the user to login with no email provided', (done) => {
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '';
  //   User.save(() => {
  //     chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ password: 'lottanumbers35555', email: '' })
  //       .end((err, resp) => {
  //         expect(resp).to.have.status(400);
  //         done();
  //       });
  //   });
  // });
  // it('should not allow the user to login with no password in user document', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = '';
  //   User.resetCode = '';
  //   await User.save();
  //   let cb;
  //   try {
  //     cb = await chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ password: 'lottanumbers35555', email: 'foo3@example.com' });
  //     expect(cb).to.have.status(401);
  //   } catch (e) { throw e; }
  // });
  // it('should not allow the user to login with correct email but incorect password', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.verifiedEmail = true;
  //   User.resetCode = '';
  //   await User.save();
  //   let cb;
  //   try {
  //     cb = await chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ email: 'foo3@example.com', password: 'fewnumbers33' });
  //     expect(cb).to.have.status(401);
  //   } catch (e) { throw e; }
  //   await User1.deleteMany({});
  // });
  // it('prevents user to login without email varification', (done) => {
  //   const User = new User1();
  //   User.name = 'foo4';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '12345';
  //   User.save(() => {
  //     chai.request(server)
  //       .post('/user/auth/login')
  //       .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
  //       .end((err, resp) => {
  //         expect(resp).to.have.status(401);
  //         done();
  //       });
  //   });
  // });
  // it('resets the password', async () => {
  //   await User1.deleteMany({});
  //   const User = new User1();
  //   User.name = 'foo3';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '12345';
  //   await User.save();
  //   let cb;
  //   try {
  //     cb = await chai.request(server)
  //       .put('/user/auth/pswdreset')
  //       .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '12345' });
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });
  // it('does not reset the password with an invalid code', (done) => {
  //   const User = new User1();
  //   User.name = 'foo3';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '12345';
  //   User.save(() => {
  //     chai.request(server)
  //       .put('/user/auth/pswdreset')
  //       .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '11111' })
  //       .end((err, res) => {
  //         expect(res).to.have.status(400);
  //         done();
  //       });
  //   });
  // });
  // it('does not reset the password with an invalid password', (done) => {
  //   const User = new User1();
  //   User.name = 'foo3';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '12345';
  //   User.save(() => {
  //     chai.request(server)
  //       .put('/user/auth/pswdreset')
  //       .send({ email: 'foo3@example.com', password: 'gyg', resetCode: '12345' })
  //       .end((err, res) => {
  //         expect(res).to.have.status(400);
  //         done();
  //       });
  //   });
  // });
  // it('catches findOneAndUpdate error when reset the password', (done) => {
  //   const User = new User1();
  //   User.name = 'foo3';
  //   User.email = 'foo3@example.com';
  //   User.password = 'lottanumbers35555';
  //   User.resetCode = '12345';
  //   const uMock = sinon.mock(User1);
  //   uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
  //   User.save(() => {
  //     chai.request(server)
  //       .put('/user/auth/pswdreset')
  //       .send({ email: 'foo3@example.com', password: 'gyggyggyg', resetCode: '12345' })
  //       .end((err, res) => {
  //         expect(res).to.have.status(500);
  //         uMock.restore();
  //         done();
  //       });
  //   });
  // });
});

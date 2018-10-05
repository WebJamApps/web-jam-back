const server = require('../../../index');
const User1 = require('../../../model/user/user-schema');
const authUtils = require('../../../auth/authUtils');

describe('functional test for users', () => {
  let allowedUrl;
  beforeEach((done) => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    done();
  });
  afterEach(async () => {
    await User1.deleteMany({});
  });
  it('finds a user by email', async () => {
    await User1.deleteMany({});
    const User2 = new User1();
    User2.name = 'foo';
    User2.email = 'foo3@example.com';
    await User2.save();
    try {
      const cb = await chai.request(server)
        .post('/user')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ email: 'foo3@example.com' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('catches error on find a user by email', async () => {
    await User1.deleteMany({});
    const User2 = new User1();
    User2.name = 'foo';
    User2.email = 'foo3@example.com';
    await User2.save();
    const uMock = sinon.mock(User1);
    uMock
      .expects('findOne')
      .chain('exec')
      .rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .post('/user')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ email: 'foo3@example.com' });
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns error on find a user by email when no user is found', async () => {
    await User1.deleteMany({});
    const User2 = new User1();
    User2.name = 'foo';
    User2.email = 'foo3@example.com';
    await User2.save();
    const uMock = sinon.mock(User1);
    uMock
      .expects('findOne')
      .chain('exec')
      .resolves();
    try {
      const cb = await chai.request(server)
        .post('/user')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ email: 'foo3@example.com' });
      expect(cb).to.have.status(400);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('finds a user by id', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo3@example.com';
    await User.save();
    try {
      const cb = await chai.request(server)
        .get(`/user/${User._id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('updates a user', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo3@example.com';
    const newUser = await User.save();
    try {
      const cb = await chai.request(server)
        .put(`/user/${newUser.id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ name: 'foobar' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('deletes a user', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo3@example.com';
    const newUser = await User.save();
    try {
      const cb = await chai.request(server)
        .delete(`/user/${newUser.id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('signs up the new user', async () => {
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({
          email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555'
        });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });
  it('returns db.create error when signs up the new user', async () => {
    const uMock = sinon.mock(User1);
    uMock.expects('create').rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({
          email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555'
        });
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findOne error when signs up the new user', async () => {
    const uMock = sinon.mock(User1);
    uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({
          email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555'
        });
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('returns findByIdAndRemove error when signs up the existing user', async () => {
    await User1.create({ name: 'foowee', email: 'foo3@example.com', verifiedEmail: false });
    const uMock = sinon.mock(User1);
    uMock.expects('findByIdAndRemove').chain('exec').rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({
          email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555'
        });
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    uMock.restore();
  });
  it('should not signup the new user if the email already exists and has been verified', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo4@example.com';
    User.verifiedEmail = true;
    await User.save();
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({
          email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555',
        });
      expect(cb).to.have.status(409);
    } catch (e) { throw e; }
  });

  it('allows signup the existing user if the email has not been verified', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo4@example.com';
    User.verifiedEmail = false;
    await User.save();
    try {
      const cb = await chai.request(server)
        .post('/user/auth/signup')
        .send({ email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555' });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });

  it('should not signup the new user if the name, password, or email is not valid', (done) => {
    chai.request(server)
      .post('/user/auth/signup')
      .send({ email: 'foo4example.com', password: '00' })
      .end((err, res) => {
        expect(res).to.have.status(409);
        done();
      });
  });

  it('allows the user to login with email', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.verifiedEmail = true;
    User.resetCode = '';
    await User.save();
    try {
      const cb = await chai.request(server)
        .post('/user/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });

  it('returns findOne error when user login with email', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.verifiedEmail = true;
    User.resetCode = '';
    await User.save();
    const uMock = sinon.mock(User1);
    uMock.expects('findOne').chain('exec').rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .post('/user/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' });
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    uMock.restore();
  });

  it('should not allow the user to login with incorrect email', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '';
    User.save(() => {
      chai.request(server)
        .post('/user/auth/login')
        .send({ password: 'lottanumbers35555', email: 'foogie@yoyo.com' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should not allow the user to login with no email provided', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '';
    User.save(() => {
      chai.request(server)
        .post('/user/auth/login')
        .send({ password: 'lottanumbers35555', email: '' })
        .end((err, resp) => {
          expect(resp).to.have.status(400);
          done();
        });
    });
  });
  it('should not allow the user to login with no password in user document', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = '';
    User.resetCode = '';
    await User.save();
    let cb;
    try {
      cb = await chai.request(server)
        .post('/user/auth/login')
        .send({ password: 'lottanumbers35555', email: 'foo3@example.com' });
      expect(cb).to.have.status(401);
    } catch (e) { throw e; }
  });

  it('should not allow the user to login with correct email but incorect password', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.verifiedEmail = true;
    User.resetCode = '';
    await User.save();
    let cb;
    try {
      cb = await chai.request(server)
        .post('/user/auth/login')
        .send({ email: 'foo3@example.com', password: 'fewnumbers33' });
      expect(cb).to.have.status(401);
    } catch (e) { throw e; }
    await User1.deleteMany({});
  });

  it('prevents user to login without email varification', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save(() => {
      chai.request(server)
        .post('/user/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });
  it('resets the password', async () => {
    await User1.deleteMany({});
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    await User.save();
    let cb;
    try {
      cb = await chai.request(server)
        .put('/user/auth/pswdreset')
        .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '12345' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('does not reset the password with an invalid code', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save(() => {
      chai.request(server)
        .put('/user/auth/pswdreset')
        .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '11111' })
        .end((err, res) => {
          expect(res).to.have.status(401);
          done();
        });
    });
  });

  it('does not reset the password with an invalid password', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save(() => {
      chai.request(server)
        .put('/user/auth/pswdreset')
        .send({ email: 'foo3@example.com', password: 'gyg', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(400);
          done();
        });
    });
  });

  it('catches findOneAndUpdate error when reset the password', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    const uMock = sinon.mock(User1);
    uMock.expects('findOneAndUpdate').chain('exec').rejects(new Error('bad'));
    User.save(() => {
      chai.request(server)
        .put('/user/auth/pswdreset')
        .send({ email: 'foo3@example.com', password: 'gyggyggyg', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(500);
          uMock.restore();
          done();
        });
    });
  });
//
//   it('sends a varification email for change email request', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/changeemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foo4@foo.com' })
//         .end((err, res) => {
//           expect(res).to.have.status(201);
//           done();
//         });
//     });
//   });
//
//   it('does not allow change email to an already existing email', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/changeemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foo3@example.com' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
//
//   it('does not allow change email to a non existing user', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/changeemail')
//         .send({ email: 'foo4@example.com', changeemail: 'foo4@example.com' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
//
//   it('updates the email to the new email when pin is correct', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.changeemail = 'foo@bar.com';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/updateemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foo@bar.com', resetCode: '12345' })
//         .end((err, res) => {
//           expect(res).to.have.status(201);
//           done();
//         });
//     });
//   });
//
//   it('does not update the email to the new email when email is not valid format', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.changeemail = 'foo@bar.com';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/updateemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foobar.com', resetCode: '12345' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
//
//   it('does not update the email to the new email when current email does not exist', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.changeemail = 'foo@bar.com';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/updateemail')
//         .send({ email: 'foo@example.com', changeemail: 'foo@bar.com', resetCode: '12345' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
//
//   it('does not update the email to the new email when the reset code is not correct', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.changeemail = 'foo@bar.com';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/updateemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foo@bar.com', resetCode: '12347' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
//
//   it('does not update the email to the new email when the changeemail does not match', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.changeemail = 'foo@bar.com';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/updateemail')
//         .send({ email: 'foo3@example.com', changeemail: 'foo12@bar.com', resetCode: '12345' })
//         .end((err, res) => {
//           expect(res).to.have.status(409);
//           done();
//         });
//     });
//   });
});

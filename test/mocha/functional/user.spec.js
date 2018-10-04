const server = require('../../../index');
const User1 = require('../../../model/user/user-schema');
const authUtils = require('../../../auth/authUtils');

describe('functional test for users', () => {
  let allowedUrl;
  beforeEach((done) => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    done();
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
  it('should signup the new user', async () => {
    try {
      const cb = await chai.request(server)
        .post('/auth/signup')
        .send({
          email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555', id: 'yoyo23'
        });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
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
        .post('/auth/signup')
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
        .post('/auth/signup')
        .send({ email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555' });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });

  it('should not signup the new user if the name, password, or email is not valid', (done) => {
    chai.request(server)
      .post('/auth/signup')
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

  it('should not allow the user to login with incorrect email', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '';
    User.save((err) => {
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
    User.save((err) => {
      chai.request(server)
        .post('/user/auth/login')
        .send({ password: 'lottanumbers35555', email: '' })
        .end((err, resp) => {
          expect(resp).to.have.status(400);
          done();
        });
    });
  });
  //
  //   it('should not allow the user to login with no password in user document', (done) => {
  //     const User = new User1();
  //     User.name = 'foo4';
  //     User.email = 'foo3@example.com';
  //     User.password = '';
  //     // User.id = 'yoyo23';
  //     User.resetCode = '';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ password: 'lottanumbers35555', email: 'foo3@example.com' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should not allow the user to login with correct email but incorect password', (done) => {
  //     const User = new User1();
  //     User.name = 'foo4';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     User.verifiedEmail = true;
  //     // User.id = 'yoyo23';
  //     User.resetCode = '';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ email: 'foo3@example.com', password: 'fewnumbers33' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('prevents user to login without email varification', (done) => {
  //     const User = new User1();
  //     User.name = 'foo4';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     // User.id = 'yoyo23';
  //     User.resetCode = '12345';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should allow the user to login after requesting a password reset', (done) => {
  //     const User = new User1();
  //     User.name = 'foo4';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     User.resetCode = '12345';
  //     User.verifiedEmail = true;
  //     User.isPswdReset = true;
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(200);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should allow the user to login with their old email after requesting a change email', (done) => {
  //     const User = new User1();
  //     User.name = 'foo4';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     User.resetCode = '12345';
  //     User.verifiedEmail = true;
  //     User.changeemail = 'foo@bar.com';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(200);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should not login the user when email does not exist', (done) => {
  //     chai.request(server)
  //       .post('/auth/login')
  //       .set({ origin: allowedUrl })
  //       .send({ email: 'yoyo@example.com', password: 'lottanumbers35555' })
  //       .end((err, res) => {
  //         expect(res).to.have.status(401);
  //         done();
  //       });
  //   });
  //
  //   it('should not login the user with incorrect password', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     User.resetCode = '';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .send({ email: 'foo3@example.com', password: 'notlottanumbers5' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should not login the user when email has not been verified', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.password = 'lottanumbers35555';
  //     User.resetCode = '12345';
  //     User.save((err) => {
  //       chai.request(server)
  //         .post('/auth/login')
  //         .set({ origin: allowedUrl })
  //         .send({ email: 'foo3@example.com', password: 'notlottanumbers5' })
  //         .end((err, resp) => {
  //           expect(resp).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should validate the new user email', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.resetCode = '12345';
  //     User.save((err) => {
  //       chai.request(server)
  //         .put('/auth/validemail')
  //         .send({ email: 'foo3@example.com', resetCode: '12345' })
  //         .end((err, res) => {
  //           expect(res).to.have.status(201);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('should not validate the new user email with incorrect code', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.resetCode = '12345';
  //     User.save((err) => {
  //       chai.request(server)
  //         .put('/auth/validemail')
  //         .send({ email: 'foo3@example.com', resetCode: '12222' })
  //         .end((err, res) => {
  //           expect(res).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('handles a reset password request with a valid email', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.verifiedEmail = true;
  //     User.save((err) => {
  //       chai.request(server)
  //         .put('/auth/resetpass')
  //         .send({ email: 'foo3@example.com' })
  //         .end((err, res) => {
  //           expect(res).to.have.status(201);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('does not allow a reset password request with an unverified email', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.verifiedEmail = false;
  //     User.save((err) => {
  //       chai.request(server)
  //         .put('/auth/resetpass')
  //         .send({ email: 'foo3@example.com' })
  //         .end((err, res) => {
  //           expect(res).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
  //   it('does not allow a reset password request with an invalid email', (done) => {
  //     const User = new User1();
  //     User.name = 'foo3';
  //     User.email = 'foo3@example.com';
  //     User.save((err) => {
  //       chai.request(server)
  //         .put('/auth/resetpass')
  //         .send({ email: 'foosy4@example.com' })
  //         .end((err, res) => {
  //           expect(res).to.have.status(401);
  //           done();
  //         });
  //     });
  //   });
  //
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
//
//   it('does not reset the password with an invalid code', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/passwdreset')
//         .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '11111' })
//         .end((err, res) => {
//           expect(res).to.have.status(401);
//           done();
//         });
//     });
//   });
//
//   it('does not reset the password with an invalid password', (done) => {
//     const User = new User1();
//     User.name = 'foo3';
//     User.email = 'foo3@example.com';
//     User.password = 'lottanumbers35555';
//     User.resetCode = '12345';
//     User.save((err) => {
//       chai.request(server)
//         .put('/auth/passwdreset')
//         .send({ email: 'foo3@example.com', password: 'gyg', resetCode: '12345' })
//         .end((err, res) => {
//           expect(res).to.have.status(401);
//           done();
//         });
//     });
//   });
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

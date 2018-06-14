const User1 = require('../../model/user/user-schema');
const authUtils = require('../../auth/authUtils');

describe('functional test for users', () => {
  beforeEach((done) => {
    // User1.collection.drop();
    // User1.ensureIndexes(() => {});
    sinon.mock(User1, 'find');
    sinon.mock(User1, 'create');
  });

  it('should create a new user', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo@example.com';
    User.save((err) => {
      const id = User._id;
      expect(id).to.not.be.null; // eslint-disable-line no-unused-expressions
      done();
    });
  });

  it('should not update a user when using a ID that does not exist', (done) => {
    const Uid = '587298a376d5036c68b6ef12';
    chai.request(server)
      .put('/user/' + Uid)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ userType: 'coolGuy' })
      .end((err, res) => {
        expect(res).to.have.status(404);
        done();
      });
  });

  it('should not update a user when the name is an empty string', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo2@example.com';
    User.save((err) => {
      chai.request(server)
        .put('/user/' + User._id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .send({ name: '' })
        .end((err, res) => {
          expect(res).to.have.status(400);
          expect(res.nModified === 0);
          done();
        });
    });
  });

  it('should modify a user', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo2@example.com';
    User.save();
    chai.request(server)
      .put('/user/' + User.id)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ name: 'foobar' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.nModified > 0);
        done();
      });
  });

  it('should delete a user', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo2@example.com';
    User.save();
    chai.request(server)
      .delete('/user/' + User.id)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(204);
        done();
      });
  });

  it('should not delete a user when id does not exist', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo2@example.com';
    User.save();
    chai.request(server)
      .delete('/user/53cb6b9b4f4ddef1ad47f943')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(404);
        done();
      });
  });

  it('should find a user by id', (done) => {
    const User = new User1();
    User.name = 'foo';
    User.email = 'foo3@example.com';
    User.save();
    chai.request(server)
      .get('/user/' + User._id)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });

  it('should find a user by email', (done) => {
    const User2 = new User1();
    User2.name = 'foo';
    User2.email = 'foo3@example.com';
    User2.save();
    chai.request(server)
      .post('/user/')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ email: 'foo3@example.com' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
  });

  it('should NOT find a user by id', (done) => {
    const id = '587298a376d5036c68b6ef12';
    chai.request(server)
      .get('/user/' + id)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(404);
        done();
      });
  });

  it('should return 404 error when Id not valid on update', (done) => {
    const Uid = '5872';
    chai.request(server)
      .put('/user/' + Uid)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ alien: 'yes' })
      .end((err, res) => {
        expect(err).to.be.an('error');
        expect(res).to.have.status(400);
        done();
      });
  });

  it('should throw an error in findById()', (done) => {
    const id = 'TYgsfn';
    chai.request(server)
      .get('/user/' + id)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(err).to.be.an('error');
        done();
      });
  });

  it('should return 404 error when Id not valid on delete', (done) => {
    const Uid = '5872';
    chai.request(server)
      .delete('/user/' + Uid)
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(err).to.be.an('error');
        expect(res).to.have.status(400);
        done();
      });
  });

  it('should get the new user by id', (done) => {
    const User = new User1();
    User.name = 'foo2';
    User.email = 'foo2@example.com';
    User.save((err) => {
      const Uid = User._id;
      chai.request(server)
        .get('/user/' + Uid)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .end((err, res) => {
          expect(res).to.have.status(200);
          done();
        });
    });
  });

  it('should update the new user by id', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.save((err) => {
      const Uid = User._id;
      chai.request(server)
        .put('/user/' + Uid)
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .send({ userType: 'Developer' })
        .end((err, res) => {
          expect(res).to.have.status(200);
          done();
        });
    });
  });

  it('should delete the user by id', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.save((err) => {
      const Uid = User._id;
      chai.request(server)
        .delete('/user/' + Uid)
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .end((err, res) => {
          expect(res).to.have.status(204);
          done();
        });
    });
  });

  it('should signup the new user', (done) => {
    chai.request(server)
      .post('/auth/signup')
      .send({
        email: 'foo3@example.com', name: 'foomanchew', password: 'lottanumbers35555', id: 'yoyo23'
      })
      .end((err, res) => {
        expect(res).to.have.status(201);
        done();
      });
  });

  it('should not signup the new user if the email already exists and has been verified', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo4@example.com';
    User.verifiedEmail = true;
    User.save((err) => {
      chai.request(server)
        .post('/auth/signup')
        .send({ email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('allows signup the existing user if the email has not been verified', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo4@example.com';
    User.verifiedEmail = false;
    User.save((err) => {
      chai.request(server)
        .post('/auth/signup')
        .send({ email: 'foo4@example.com', name: 'foomanchew', password: 'lottanumbers35555' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
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

  it('should allow the user to login with email', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.verifiedEmail = true;
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
        .end((err, resp) => {
          expect(resp).to.have.status(200);
          done();
        });
    });
  });

  it('should not allow the user to login with incorrect email', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    // User.id = 'yoyo23';
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
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
    // User.id = 'yoyo23';
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ password: 'lottanumbers35555', email: '' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should not allow the user to login with no password in user document', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = '';
    // User.id = 'yoyo23';
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ password: 'lottanumbers35555', email: 'foo3@example.com' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should not allow the user to login with correct email but incorect password', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.verifiedEmail = true;
    // User.id = 'yoyo23';
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'fewnumbers33' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('prevents user to login without email varification', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    // User.id = 'yoyo23';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should allow the user to login after requesting a password reset', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.verifiedEmail = true;
    User.isPswdReset = true;
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
        .end((err, resp) => {
          expect(resp).to.have.status(200);
          done();
        });
    });
  });

  it('should allow the user to login with their old email after requesting a change email', (done) => {
    const User = new User1();
    User.name = 'foo4';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.verifiedEmail = true;
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'lottanumbers35555' })
        .end((err, resp) => {
          expect(resp).to.have.status(200);
          done();
        });
    });
  });

  it('should not login the user when email does not exist', (done) => {
    chai.request(server)
      .post('/auth/login')
      .set({ origin: allowedUrl })
      .send({ email: 'yoyo@example.com', password: 'lottanumbers35555' })
      .end((err, res) => {
        expect(res).to.have.status(401);
        done();
      });
  });

  it('should not login the user with incorrect password', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .send({ email: 'foo3@example.com', password: 'notlottanumbers5' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should not login the user when email has not been verified', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .post('/auth/login')
        .set({ origin: allowedUrl })
        .send({ email: 'foo3@example.com', password: 'notlottanumbers5' })
        .end((err, resp) => {
          expect(resp).to.have.status(401);
          done();
        });
    });
  });

  it('should validate the new user email', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .put('/auth/validemail')
        .send({ email: 'foo3@example.com', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
  });

  it('should not validate the new user email with incorrect code', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .put('/auth/validemail')
        .send({ email: 'foo3@example.com', resetCode: '12222' })
        .end((err, res) => {
          expect(res).to.have.status(401);
          done();
        });
    });
  });

  it('handles a reset password request with a valid email', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.verifiedEmail = true;
    User.save((err) => {
      chai.request(server)
        .put('/auth/resetpass')
        .send({ email: 'foo3@example.com' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
  });

  it('does not allow a reset password request with an unverified email', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.verifiedEmail = false;
    User.save((err) => {
      chai.request(server)
        .put('/auth/resetpass')
        .send({ email: 'foo3@example.com' })
        .end((err, res) => {
          expect(res).to.have.status(401);
          done();
        });
    });
  });

  it('does not allow a reset password request with an invalid email', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/resetpass')
        .send({ email: 'foosy4@example.com' })
        .end((err, res) => {
          expect(res).to.have.status(401);
          done();
        });
    });
  });

  it('resets the password', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .put('/auth/passwdreset')
        .send({ email: 'foo3@example.com', password: 'gygygygy', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
  });

  it('does not reset the password with an invalid code', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.save((err) => {
      chai.request(server)
        .put('/auth/passwdreset')
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
    User.save((err) => {
      chai.request(server)
        .put('/auth/passwdreset')
        .send({ email: 'foo3@example.com', password: 'gyg', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(401);
          done();
        });
    });
  });

  it('sends a varification email for change email request', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.save((err) => {
      chai.request(server)
        .put('/auth/changeemail')
        .send({ email: 'foo3@example.com', changeemail: 'foo4@foo.com' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
  });

  it('does not allow change email to an already existing email', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.save((err) => {
      chai.request(server)
        .put('/auth/changeemail')
        .send({ email: 'foo3@example.com', changeemail: 'foo3@example.com' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('does not allow change email to a non existing user', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.save((err) => {
      chai.request(server)
        .put('/auth/changeemail')
        .send({ email: 'foo4@example.com', changeemail: 'foo4@example.com' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('updates the email to the new email when pin is correct', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/updateemail')
        .send({ email: 'foo3@example.com', changeemail: 'foo@bar.com', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(201);
          done();
        });
    });
  });

  it('does not update the email to the new email when email is not valid format', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/updateemail')
        .send({ email: 'foo3@example.com', changeemail: 'foobar.com', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('does not update the email to the new email when current email does not exist', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/updateemail')
        .send({ email: 'foo@example.com', changeemail: 'foo@bar.com', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('does not update the email to the new email when the reset code is not correct', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/updateemail')
        .send({ email: 'foo3@example.com', changeemail: 'foo@bar.com', resetCode: '12347' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });

  it('does not update the email to the new email when the changeemail does not match', (done) => {
    const User = new User1();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.password = 'lottanumbers35555';
    User.resetCode = '12345';
    User.changeemail = 'foo@bar.com';
    User.save((err) => {
      chai.request(server)
        .put('/auth/updateemail')
        .send({ email: 'foo3@example.com', changeemail: 'foo12@bar.com', resetCode: '12345' })
        .end((err, res) => {
          expect(res).to.have.status(409);
          done();
        });
    });
  });
});

const User1 = require('../../model/user/user-schema');
const authUtils = require('../../auth/authUtils');
describe('functional test Create User',  () => {
  beforeEach((done) => {
    mockgoose(mongoose).then(() => {
      User1.collection.drop();
      User1.ensureIndexes(() => {
        allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
        global.server = require('../../index'); // eslint-disable-line global-require
        done();
      });
    });
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
      // TODO: Write a GET request to verify that user's name has been changed
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

  // it('should return an error in update() when nothing was updated', (done) => {
  //   const Uid = '587298a376d5036c68b6ef12';
  //   chai.request(server)
  //   .put('/user/' + Uid)
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .send({ alien: 'yes' })
  //   .end((err, res) => {
  //     expect(err).to.be.an('error');
  //     done();
  //   });
  // });

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

  it('should return 404 error when Id no valid on delete', (done) => {
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
});

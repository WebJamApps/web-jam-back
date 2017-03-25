const User2 = require('../../model/user/user-schema');

const authUtils = require('../../auth/authUtils');

describe('functional test Create User', () => {
  beforeEach((done) => {
    User2.collection.drop();
    User2.ensureIndexes();
    mockgoose(mongoose).then(() => {
      allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
      global.server = require('../../index');
      done();
    });
  });
  
  it('should get the new user by id', (done) => {
    const User = new User2();
    User.name = 'foo2';
    User.email = 'foo2@example.com';
    User.save((err) => {
      const Uid = User._id;
      chai.request(server)
      .get('/user/' + Uid)
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
    });
  });
  
  it('should update the new user by id', (done) => {
    const User = new User2();
    User.name = 'foo3';
    User.email = 'foo3@example.com';
    User.save((err) => {
      const Uid = User._id;
      chai.request(server)
      .put('/user/' + Uid)
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ userType: 'Charity' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
    });
  });
});

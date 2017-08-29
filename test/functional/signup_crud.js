const Signup1 = require('../../model/signup/signup-schema');
const authUtils = require('../../auth/authUtils');

describe('The signup feature',  () => {
  beforeEach((done) => {
    mockgoose(mongoose).then(() => {
      Signup1.ensureIndexes(() => {
        allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
        global.server = require('../../index'); // eslint-disable-line global-require
        done();
      });
    });
  });

  it('should create a new signup', (done) => {
    // voloppId: { type: String, required: true },
    // userId: { type: String, required: true },
    // numPeople: { type: Number, required: true },
    // groupName: { type: String, required: false }
    chai.request(server)
    .post('/signup/create')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ voloppId: '1234', userId: '24153', numPeople: 1, groupName: '' })
    .end((err, res) => {
      expect(res).to.have.status(201);
      done();
    });
  });

  // it('should get the charities that are managed by this user', (done) => {
  //   chai.request(server)
  //   .get('/charity/1223')
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .end((err, res) => {
  //     expect(res).to.have.status(200);
  //     done();
  //   });
  // });
  //
  // it('should get the charity by its id', (done) => {
  //   const Charity = new Charity1();
  //   Charity.charityName = 'foo';
  //   Charity.charityZipCode = '12345';
  //   Charity.charityMngIds = ['12345'];
  //   Charity.save();
  //   chai.request(server)
  //   .get('/charity/find/' + Charity._id)
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .end((err, res) => {
  //     expect(res).to.have.status(200);
  //     done();
  //   });
  // });
  //
  // it('should delete a charity', (done) => {
  //   const Charity = new Charity1();
  //   Charity.charityName = 'foo';
  //   Charity.charityZipCode = '12345';
  //   Charity.charityMngIds = ['12345'];
  //   Charity.save();
  //   chai.request(server)
  //   .delete('/charity/' + Charity.id)
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .end((err, res) => {
  //     expect(res).to.have.status(204);
  //     done();
  //   });
  // });
  //
  // it('should modify a charity', (done) => {
  //   const Charity2 = new Charity1();
  //   Charity2.charityName = 'foo2';
  //   Charity2.charityZipCode = '22222';
  //   Charity2.charityMngIds = ['33333'];
  //   Charity2.save();
  //   chai.request(server)
  //   .put('/charity/' + Charity2.id)
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .send({ charityName: 'foobar' })
  //   .end((err, res) => {
  //     expect(res).to.have.status(200);
  //     expect(res.nModified > 0);
  //     done();
  //   });
  // });

});
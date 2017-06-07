const Charity1 = require('../../model/charity/charity-schema');
const authUtils = require('../../auth/authUtils');

describe('The charity feature',  () => {
  beforeEach((done) => {
    mockgoose(mongoose).then(() => {
      Charity1.ensureIndexes(() => {
        allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
        global.server = require('../../index'); // eslint-disable-line global-require
        done();
      });
    });
  });
  it('should create a new charity', (done) => {
    chai.request(server)
    .post('/charity/create')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ charityName: 'homeless shelter', charityZipCode: '24153', charityMngIds: ['1223'] })
    .end((err, res) => {
      expect(res).to.have.status(201);
      done();
    });
  });
});

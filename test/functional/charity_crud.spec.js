const Charity1 = require('../../model/charity/charity-schema');
const authUtils = require('../../auth/authUtils');

describe('The Charity feature', () => {
  let server, create, allowedUrl;
  beforeEach(async () => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    server = require('../../index'); // eslint-disable-line global-require
    create = await sinon.mock(Charity1, 'create');
  });

  afterEach(async () => {
    create.restore();
  });

  it('should create a new charity', async () => {
    try {
      const cb = await chai.request(server)
        .post('/charity/create')
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .send({ charityName: 'homeless shelter', charityZipCode: '24153', charityMngIds: ['1223'] });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });

  // it('should get the charities that are managed by this userid', async () => {
  //   try {
  //     const cb = await chai.request(server)
  //       .get('/charity/1223')
  //       .set({ origin: allowedUrl })
  //       .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'));
  //     expect(cb).to.have.status(200);
  //   } catch (e) { throw e; }
  // });

  it('should get the charity by its id', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'foo';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .get('/charity/find/' + Charity._id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'));
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
    Charity1.remove({ name:'foo' });
  });

  it('should get the charity by its manager id', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'foo';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .get('/charity/' + Charity.charityMngIds[0])
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'));
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
    await Charity1.remove({ name:'foo' });
  });

  it('should update the charity', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'fooberrypie3';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .put('/charity/' + Charity._id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .send({ charityName:'barbasol' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
    await Charity1.remove({ name:'barbasol' });
  });

  it('should delete the charity', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'fooberrypie4';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .delete('/charity/' + Charity._id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'));
        // .send({ charityName:'barbasol' });
      expect(cb).to.have.status(204);
    } catch (e) { throw e; }
  //  await Charity1.remove({ name:'barbasol' });
  });
  // it('should delete a charity', (done) => {
  //   const Charity = new Charity1();
  //   Charity.charityName = 'foo';
  //   Charity.charityZipCode = '12345';
  //   Charity.charityMngIds = ['12345'];
  //   Charity.save();
  //   chai.request(server)
  //     .delete('/charity/' + Charity.id)
  //     .set({ origin: allowedUrl })
  //     .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //     .end((err, res) => {
  //       expect(res).to.have.status(204);
  //       done();
  //     });
  // });

  // it('should update a charity', (done) => {
  //   const Charity2 = new Charity1();
  //   Charity2.charityName = 'foo2';
  //   Charity2.charityZipCode = '22222';
  //   Charity2.charityMngIds = ['33333'];
  //   Charity2.save();
  //   chai.request(server)
  //     .put('/charity/' + Charity2.id)
  //     .set({ origin: allowedUrl })
  //     .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //     .send({ charityName: 'foobar' })
  //     .end((err, res) => {
  //       expect(res).to.have.status(200);
  //       expect(res.nModified > 0);
  //       done();
  //     });
  // });
});

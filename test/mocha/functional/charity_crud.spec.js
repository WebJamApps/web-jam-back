const EventEmitter = require('events');
const Charity1 = require('../../../model/charity/charity-schema');
const authUtils = require('../../../auth/authUtils');
const server = require('../../../index');

EventEmitter.defaultMaxListeners = 35;
const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
describe('The Charity feature', () => {
  // let myEmitter;
  beforeEach((done) => {
    // myEmitter = new EventEmitter();
    // myEmitter.setMaxListeners(myEmitter.getMaxListeners() + 11);
    done();
  });
  afterEach(async () => {
    await Charity1.deleteMany({});
    // myEmitter.setMaxListeners(myEmitter.getMaxListeners() - 11);
  });
  it('creates a new charity', async () => {
    try {
      const cb = await chai.request(server)
        .post('/charity/create')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ charityName: 'homeless shelter', charityZipCode: '24153', charityMngIds: ['1223'] });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });
  it('gets the charity by its id', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'foo';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .get(`/charity/find/${Charity._id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });

  it('gets the charity by manager id', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'foo';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .get(`/charity/${Charity.charityMngIds[0]}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });

  it('updates the charity', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'fooberrypie3';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .put(`/charity/${Charity._id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ charityName: 'barbasol' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });

  it('deletes the charity', async () => {
    const Charity = new Charity1();
    Charity.charityName = 'fooberrypie4';
    Charity.charityZipCode = '12345';
    Charity.charityMngIds = ['12345'];
    await Charity.save();
    try {
      const cb = await chai.request(server)
        .delete(`/charity/${Charity._id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
});

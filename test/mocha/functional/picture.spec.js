const sinon = require('sinon');
require('sinon-mongoose');
const server = require('../../../index');
const PictureModel = require('../../../model/picture/picture-schema');
const authUtils = require('../../../auth/authUtils');

describe('The Picture API', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
  const newPicture = {
    alt: 'coolpic',
    src: 'http://coolpic.com/coolpic.jpg',
    page: '/ohaf'
  };
  beforeEach(async () => {
    await PictureModel.deleteMany({});
  });
  it('should create a new picture', async () => {
    try {
      const cb = await chai.request(server)
        .post('/picture')
        .set({
          origin: allowedUrl
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send(newPicture);
      expect(cb).to.have.status(201);
    } catch (e) {
      throw e;
    }
  });
  it('returns all pictures', async () => {
    await PictureModel.create(newPicture);
    try {
      const cb = await chai.request(server)
        .get('/picture')
        .set({
          origin: allowedUrl
        });
      expect(cb.body.length).to.equal(1);
      expect(cb.status).to.equal(200);
    } catch (e) {
      throw e;
    }
  });
  it('deletes all pictures', async () => {
    await PictureModel.create(newPicture);
    try {
      const cb = await chai.request(server)
        .delete('/picture')
        .set({
          origin: allowedUrl
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb.status).to.equal(200);
    } catch (e) {
      throw e;
    }
  });
  it('returns deleteMany error when deletes all pictures', async () => {
    await PictureModel.create(newPicture);
    const sMock = sinon.mock(PictureModel);
    sMock.expects('deleteMany').chain('exec').rejects(new Error('bad'));
    try {
      const cb = await chai.request(server)
        .delete('/picture')
        .set({
          origin: allowedUrl
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb.status).to.equal(500);
    } catch (e) {
      throw e;
    }
  });
});

const server = require('../../../index');
const SongModel = require('../../../model/song/song-schema');
const authUtils = require('../../../auth/authUtils');

describe('The Song API', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
  beforeEach(async () => {
    await SongModel.deleteMany({});
  });
  it('should create a new song', async () => {
    try {
      const cb = await chai.request(server)
        .post('/song/')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({
          title: 'foobar', url: 'http://foo.com', category: 'original', author: 'booya', performer: 'howdy boys'
        });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });
  it('should return all books', async () => {
    await SongModel.create({
      title: 'foobar', url: 'http://foo.com', category: 'original', author: 'booya', performer: 'howdy boys'
    });
    try {
      const cb = await chai.request(server)
        .get('/song/')
        .set({ origin: allowedUrl });
      expect(cb.body.length).to.equal(1);
      expect(cb.status).to.equal(200);
    } catch (e) { throw e; }
  });
});

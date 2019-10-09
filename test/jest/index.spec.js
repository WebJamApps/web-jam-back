require('dotenv').config();
const request = require('supertest');

const AllowUrl = JSON.parse(process.env.AllowUrl);

describe('Index test', () => {
  let allowedUrl, server, r;
  beforeEach((done) => {
    [allowedUrl] = AllowUrl.urls;
    server = require('../../index'); // eslint-disable-line global-require
    done();
  });
  it('does nothing', (done) => {
    done();
  });
  it('should return status 200 when use -> app.get', async () => {
    r = await request(server)
      .get('/anyrul')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(200);
  });
  it('should return 500 error', async () => {
    r = await request(server)
      .delete('/bogus')
      .set({ origin: 'bogus' })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(500);
  });
});

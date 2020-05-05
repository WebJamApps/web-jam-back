require('dotenv').config();
const request = require('supertest');
const app = require('../../index');

const AllowUrl = JSON.parse(process.env.AllowUrl);

describe('Index test', () => {
  let allowedUrl, r, server, agent;
  beforeAll((done) => {
    server = app.listen(7000, (err) => {
      if (err) return done(err);
      agent = request.agent(server);
      return done();
    });
  });
  beforeEach((done) => {
    [allowedUrl] = AllowUrl.urls;
    done();
  });
  afterAll((done) => server && server.close(done));
  it('should return status 200 when use -> app.get', async () => {
    r = await agent
      .get('/anyrul')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(200);
  });
  it('should return 500 error', async () => {
    r = await agent
      .delete('/bogus')
      .set({ origin: 'bogus' })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(500);
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line jest/expect-expect
    const delay = (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(4000);
  });
});

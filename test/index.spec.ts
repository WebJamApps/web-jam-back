import request from 'supertest';
import app from '../src/index';

const AllowUrl = JSON.parse(process.env.AllowUrl || '{}');

describe('Index test', () => {
  let allowedUrl: any, r, server: any, agent: any;
  // eslint-disable-next-line jest/no-done-callback
  beforeAll((done) => {
    server = app.listen(7000, () => {
      agent = request.agent(server);
      return done();
    });
  });
  // eslint-disable-next-line jest/no-done-callback
  beforeEach((done) => {
    [allowedUrl] = AllowUrl.urls;
    done();
  });
  // eslint-disable-next-line jest/no-done-callback
  afterAll((done) => server && server.close(done));
  it('should return status 200 when use -> app.get', async () => {
    r = await agent
      .get('/anyrul')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(200);
  });
  it('should return status 200 when use -> app.get at root', async () => {
    r = await agent
      .get('/')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(200);
  });
  it('should return 404 error', async () => {
    r = await agent
      .delete('/bogus')
      .set({ origin: 'bogus' })
      .set('authorization', 'Bearer ');
    expect(r.status).toBe(404);
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line jest/expect-expect
    const delay = (ms: any) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(4000);
  });
});

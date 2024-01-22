import request from 'supertest';
import app from 'src/index';

describe('Inquiry Router', () => {
  let r:any;
  it('sends an email', async () => {
    r = await request(app)
      .post('/inquiry')
      .send({ email: 'yo@yo.com' });
    expect(r.status).toBe(200);
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line jest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: any) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

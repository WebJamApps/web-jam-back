import request from 'supertest';
import authUtils from '../../../src/auth/authUtils';
import app from '../../../src/index';

describe('user-router', () => {
  it('should find matching users', async () => {
    const r = await request(app)
      .get('/user')
      .query({ name: 'tester' });
    expect(r.status).toBe(200);
  });
  it('should not find matching users when production', async () => {
    process.env.NODE_ENV = 'production';
    const r = await request(app)
      .get('/user')
      .query({ name: 'tester' });
    expect(r.status).toBe(401);
  });
  it('findByEmail is not allowed', async () => {
    process.env.NODE_ENV = 'test';
    const r = await request(app)
      .post('/user');
    expect(r.status).toBe(401);
  });
  it('findByEmail does not find a match', async () => {
    process.env.NODE_ENV = 'test';
    authUtils.ensureAuthenticated = jest.fn();
    const r = await request(app)
      .post('/user');
    expect(r.status).toBe(400);
  });
  it('google', async () => {
    process.env.NODE_ENV = 'test';
    const r = await request(app)
      .post('/user/auth/google');
    expect(r.status).toBe(500);
  });
});

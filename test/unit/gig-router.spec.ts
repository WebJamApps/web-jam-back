import app from '#src/index.js';
import GigModel from '../../src/model/gig/gig-facade.js';
import userModel from '../../src/model/user/user-facade.js';
import authUtils from '../../src/auth/authUtils.js';
import request, { type ApiResponse } from '../helpers/api.js';

describe('The Gig API', () => {
  let r: ApiResponse, newUser: { _id: string; userType: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  beforeAll(async () => {
    await GigModel.deleteMany({});
    await userModel.deleteMany({});
    const createdUser = await userModel.create({
      name: 'foo',
      email: 'gig-foo@example.com',
      userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0],
    }) as unknown as { _id: { toString(): string }; userType: string };
    newUser = { _id: createdUser._id.toString(), userType: createdUser.userType };
  });
  beforeEach(async () => {
    await GigModel.deleteMany({});
  });
  it('gets all gigs without auth (public)', async () => {
    await GigModel.create({ venue: 'The Spot on Kirk', city: 'Roanoke', usState: 'Virginia' });
    r = await request(app)
      .get('/gig')
      .set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body[0].venue).toBe('The Spot on Kirk');
  });
  it('finds a gig by id', async () => {
    const gig = await GigModel.create({ venue: 'Hamlet Vineyards', city: 'Bassett', usState: 'Virginia' });
    r = await request(app)
      .get(`/gig/${gig._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
    expect(r.body.venue).toBe('Hamlet Vineyards');
  });
  it('creates a new gig', async () => {
    r = await request(app)
      .post('/gig')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({ venue: 'Twin Creeks Brewing', city: 'Vinton', usState: 'Virginia' });
    expect(r.status).toBe(201);
  });
  it('updates a gig by id', async () => {
    const gig = await GigModel.create({ venue: 'Old Venue' });
    r = await request(app)
      .put(`/gig/${gig._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({ venue: 'New Venue' });
    expect(r.status).toBe(200);
    expect(r.body.venue).toBe('New Venue');
  });
  it('deletes a gig by id', async () => {
    const gig = await GigModel.create({ venue: 'Temp Venue' });
    r = await request(app)
      .delete(`/gig/${gig._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('deletes many gigs', async () => {
    await GigModel.create({ venue: 'Bulk Venue', city: 'Salem' });
    r = await request(app)
      .delete('/gig')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .query({ city: 'Salem' });
    expect(r.status).toBe(200);
  });
  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

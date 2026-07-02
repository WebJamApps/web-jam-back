import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import BookModel from '#src/model/book/book-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../helpers/api.js';

// Artist scoping (web-jam-back#885): reads filter by ?artist=, writes stamp the
// artist, and an artist-scoped admin can only touch their own artist's records.
describe('Artist scoping', () => {
  let r: ApiResponse;
  let superUser: { _id: string };
  let timAdmin: { _id: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  const auth = (id: string) => `Bearer ${authUtils.createJWT({ _id: id })}`;

  // A role allowed through the existing AUTH_ROLES route guard for /book etc.
  // Scoping is driven by the `artist` field, not the role: superUser has no
  // artist slug (unscoped -> pre-#885 behaviour); timAdmin carries artist='tim'.
  const allowedRole = JSON.parse(process.env.AUTH_ROLES || '{}').user[0];
  beforeAll(async () => {
    await GigModel.deleteMany({});
    await BookModel.deleteMany({});
    await userModel.deleteMany({});
    const su = await userModel.create({ name: 'josh', email: 'super@example.com', userType: allowedRole }) as unknown as { _id: { toString(): string } };
    const tim = await userModel.create({
      name: 'tim', email: 'tim@example.com', userType: allowedRole, artist: 'tim',
    }) as unknown as { _id: { toString(): string } };
    superUser = { _id: su._id.toString() };
    timAdmin = { _id: tim._id.toString() };
  });
  beforeEach(async () => {
    await GigModel.deleteMany({});
    await BookModel.deleteMany({});
  });

  it('GET /gig?artist=tim returns only that artist', async () => {
    await GigModel.create({ venue: 'Legacy Hall' }); // no artist -> jammusic
    await GigModel.create({ venue: 'Tim Stage', artist: 'tim' });
    r = await request(app).get('/gig').query({ artist: 'tim' }).set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].venue).toBe('Tim Stage');
  });

  it('GET /gig with no artist returns legacy/jammusic only (excludes tim)', async () => {
    await GigModel.create({ venue: 'Legacy Hall' });
    await GigModel.create({ venue: 'JaM Hall', artist: 'jammusic' });
    await GigModel.create({ venue: 'Tim Stage', artist: 'tim' });
    r = await request(app).get('/gig').set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    const venues = (r.body as { venue: string }[]).map((g) => g.venue).sort();
    expect(venues).toEqual(['JaM Hall', 'Legacy Hall']);
  });

  it('scoped admin create is force-stamped to their artist', async () => {
    r = await request(app).post('/gig').set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id))
      .send({ venue: 'Coffee House', artist: 'somebodyelse' });
    expect(r.status).toBe(201);
    expect(r.body.artist).toBe('tim');
  });

  it('super create can set any artist', async () => {
    r = await request(app).post('/gig').set({ origin: allowedUrl }).set('Authorization', auth(superUser._id))
      .send({ venue: 'Big Venue', artist: 'tim' });
    expect(r.status).toBe(201);
    expect(r.body.artist).toBe('tim');
  });

  it('super create with no artist defaults to jammusic', async () => {
    r = await request(app).post('/gig').set({ origin: allowedUrl }).set('Authorization', auth(superUser._id))
      .send({ venue: 'Default Venue' });
    expect(r.status).toBe(201);
    expect(r.body.artist).toBe('jammusic');
  });

  it('scoped admin can update their own record', async () => {
    const g = await GigModel.create({ venue: 'Old', artist: 'tim' });
    r = await request(app).put(`/gig/${g._id}`).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id))
      .send({ venue: 'New' });
    expect(r.status).toBe(200);
    expect(r.body.venue).toBe('New');
  });

  it('scoped admin cannot update another artist record (403)', async () => {
    const g = await GigModel.create({ venue: 'JaM Only' }); // jammusic
    r = await request(app).put(`/gig/${g._id}`).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id))
      .send({ venue: 'Hijacked' });
    expect(r.status).toBe(403);
  });

  it('scoped admin cannot move their record to another artist (403)', async () => {
    const g = await GigModel.create({ venue: 'Mine', artist: 'tim' });
    r = await request(app).put(`/gig/${g._id}`).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id))
      .send({ artist: 'jammusic' });
    expect(r.status).toBe(403);
  });

  it('scoped admin cannot delete another artist record (403)', async () => {
    const g = await GigModel.create({ venue: 'JaM Only' });
    r = await request(app).delete(`/gig/${g._id}`).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id));
    expect(r.status).toBe(403);
  });

  it('scoped admin can delete their own record', async () => {
    const g = await GigModel.create({ venue: 'Mine', artist: 'tim' });
    r = await request(app).delete(`/gig/${g._id}`).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id));
    expect(r.status).toBe(200);
  });

  it('serves a public per-artist bio via GET /book/one', async () => {
    await BookModel.create({ title: 'Bio', type: 'bio', artist: 'tim', comments: 'Tim plays guitar' });
    r = await request(app).get('/book/one').query({ type: 'bio', artist: 'tim' }).set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(r.body.comments).toBe('Tim plays guitar');
  });

  it('scoped admin bio update is stamped and scoped to their artist', async () => {
    await BookModel.create({ title: 'Bio', type: 'bio', artist: 'tim', comments: 'old' });
    r = await request(app).put('/book/one').query({ type: 'bio' }).set({ origin: allowedUrl }).set('Authorization', auth(timAdmin._id))
      .send({ comments: 'new bio' });
    expect(r.status).toBe(200);
    expect(r.body.comments).toBe('new bio');
    expect(r.body.artist).toBe('tim');
  });

  it('super findOneAndUpdate normalizes a provided artist on the body', async () => {
    await BookModel.create({ title: 'Bio', type: 'bio', comments: 'jam bio' }); // jammusic (legacy)
    r = await request(app).put('/book/one').query({ type: 'bio' }).set({ origin: allowedUrl }).set('Authorization', auth(superUser._id))
      .send({ comments: 'edited', artist: '' });
    expect(r.status).toBe(200);
    expect(r.body.artist).toBe('jammusic');
  });

  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

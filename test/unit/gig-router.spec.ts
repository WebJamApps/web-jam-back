import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../helpers/api.js';

describe('The Gig API', () => {
  let r: ApiResponse, newUser: { _id: string; userType: string }, adminUser: { _id: string }, nonAdminUser: { _id: string };
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
    // #962 — announce is gated by GigController's own admin check (role
    // fallback: JaM-admin/Developer), independent of AUTH_ROLES (which has no
    // 'gig' entry — any authenticated user passes ensureAuthenticated for
    // /gig/*, same as the CRUD tests above using the plain `user` role).
    const createdAdmin = await userModel.create({
      name: 'gig-admin', email: 'gig-admin@example.com', userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    adminUser = { _id: createdAdmin._id.toString() };
    // A userType outside GigController's ALLOWED_ROLES (['JaM-admin',
    // 'Developer']) — `newUser` above is 'Developer' (AUTH_ROLES.user[0]),
    // which IS admin-allowed, so announce's 403 test needs its own account.
    const createdNonAdmin = await userModel.create({
      name: 'gig-non-admin', email: 'gig-non-admin@example.com', userType: 'plain-user',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: createdNonAdmin._id.toString() };
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
  it('serves the default promo image without auth (public, #962)', async () => {
    r = await request(app)
      .get('/gig/promo-default.jpg')
      .set({ origin: allowedUrl });
    expect(r.status).toBe(200);
  });

  describe('POST /gig/:id/announce (#962)', () => {
    const META_ENV_KEYS = ['META_IG_USER_ID', 'META_IG_ACCESS_TOKEN', 'META_FB_PAGE_ID', 'META_FB_PAGE_ACCESS_TOKEN'] as const;
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
      originalEnv = {};
      for (const k of META_ENV_KEYS) originalEnv[k] = process.env[k];
      process.env.META_IG_USER_ID = 'ig-user-1';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
      process.env.META_FB_PAGE_ID = 'page-1';
      process.env.META_FB_PAGE_ACCESS_TOKEN = 'page-token';
    });

    afterEach(() => {
      for (const k of META_ENV_KEYS) {
        if (originalEnv[k] === undefined) delete process.env[k];
        else process.env[k] = originalEnv[k];
      }
      vi.restoreAllMocks();
    });

    it('401s without an Authorization header (routing wiring)', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .send({ caption: '<p>Hi</p>' });
      expect(r.status).toBe(401);
    });

    it('403s a non-admin authenticated user (controller authorize wiring)', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: nonAdminUser._id })}`)
        .send({ caption: '<p>Hi</p>' });
      expect(r.status).toBe(403);
    });

    it('publishes both legs end-to-end (mocked Graph calls) and stamps announcedAt', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/promo.jpg' });
      // Only intercept calls to Meta's Graph API — the api.ts test helper
      // itself uses fetch() to hit the local ephemeral test server, and that
      // MUST reach the real fetch or the request never actually happens.
      // Both legs run concurrently (Promise.all in the controller), so match
      // by URL shape rather than by call order.
      const realFetch = global.fetch;
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        const urlStr = String(url);
        if (urlStr.includes('/media_publish')) return Promise.resolve({ json: () => Promise.resolve({ id: 'media-1' }) } as Response);
        if (urlStr.includes('/media')) return Promise.resolve({ json: () => Promise.resolve({ id: 'container-1' }) } as Response);
        if (urlStr.includes('/photos')) return Promise.resolve({ json: () => Promise.resolve({ id: 'photo-1' }) } as Response);
        return realFetch(url, init);
      });

      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: '<p>Big show tonight!</p>' });

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ instagram: { ok: true, id: 'media-1' }, facebook: { ok: true, id: 'photo-1' } });

      const updated = await GigModel.findById(String(gig._id));
      expect((updated as unknown as { announcedAt?: Date }).announcedAt).toBeTruthy();
    });

    it('500s with a clear message when Meta is fully unconfigured', async () => {
      for (const k of META_ENV_KEYS) delete process.env[k];
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: '<p>Hi</p>' });
      expect(r.status).toBe(500);
      expect(r.body.message).toContain('META_IG_USER_ID');
    });
  });

  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

import sharp from 'sharp';
import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import userModel from '#src/model/user/user-facade.js';
import { getInstagramKey } from '#src/lib/meta-publish.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../helpers/api.js';

const realFetch = globalThis.fetch.bind(globalThis);

describe('The Gig API', () => {
  let r: ApiResponse, newUser: { _id: string; userType: string }, adminUser: { _id: string }, nonAdminUser: { _id: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  beforeEach(async () => {
    await GigModel.deleteMany({});
    await userModel.deleteMany({
      email: { $in: ['gig-foo@example.com', 'gig-admin@example.com', 'gig-non-admin@example.com'] },
    });
    const createdUser = await userModel.create({
      name: 'foo',
      email: 'gig-foo@example.com',
      userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0],
    }) as unknown as { _id: { toString(): string }; userType: string };
    newUser = { _id: createdUser._id.toString(), userType: createdUser.userType };
    const createdAdmin = await userModel.create({
      name: 'gig-admin', email: 'gig-admin@example.com', userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    adminUser = { _id: createdAdmin._id.toString() };
    const createdNonAdmin = await userModel.create({
      name: 'gig-non-admin', email: 'gig-non-admin@example.com', userType: 'plain-user',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: createdNonAdmin._id.toString() };
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
  // web-jam-back#1058: Josh & Maria's gig records were re-tagged from
  // artist:'josh' to artist:'jammusic' so they agree with artistListFilter's
  // default-tenant convention (src/lib/artist.ts) — before that migration, a
  // plain GET /gig with no query returned an empty array even with matching
  // records in the collection.
  it('returns jammusic-tagged gigs on GET /gig with no artist query (#1058)', async () => {
    await GigModel.create({ venue: 'Jammusic Tagged Venue', artist: 'jammusic' });
    r = await request(app)
      .get('/gig')
      .set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(r.body.map((g: { venue: string }) => g.venue)).toContain('Jammusic Tagged Venue');
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
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
      .send({ venue: 'Twin Creeks Brewing', city: 'Vinton', usState: 'Virginia' });
    expect(r.status).toBe(201);
  });
  it('updates a gig by id', async () => {
    const gig = await GigModel.create({ venue: 'Old Venue' });
    r = await request(app)
      .put(`/gig/${gig._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
      .send({ venue: 'New Venue' });
    expect(r.status).toBe(200);
    expect(r.body.venue).toBe('New Venue');
  });
  it('deletes a gig by id', async () => {
    const gig = await GigModel.create({ venue: 'Temp Venue' });
    r = await request(app)
      .delete(`/gig/${gig._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('serves the default promo image without auth (public, #962)', async () => {
    r = await request(app)
      .get('/gig/promo-default.jpg')
      .set({ origin: allowedUrl });
    expect(r.status).toBe(200);
  });

  describe('GET /gig/:id/announce-image.jpg (#1202)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('404s for an unknown gig id', async () => {
      r = await request(app)
        .get('/gig/6ae4fa4e3ad5019fd1248d7b/announce-image.jpg')
        .set({ origin: allowedUrl });
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('gig not found');
    });

    it('404s for an invalid ObjectId', async () => {
      r = await request(app)
        .get('/gig/not-a-valid-id/announce-image.jpg')
        .set({ origin: allowedUrl });
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('gig not found');
    });

    it('serves public JPEG without auth when gig has announceImageUrl', async () => {
      const pngImage = await sharp({
        create: {
          width: 120, height: 120, channels: 3, background: { r: 10, g: 20, b: 30 },
        },
      }).png().toBuffer();
      const gig = await GigModel.create({ venue: 'Announce Venue', announceImageUrl: 'https://example.com/source.png' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/source.png') {
          return Promise.resolve(new Response(pngImage));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/jpeg');
    });

    it('pads too-tall source image without cropping', async () => {
      const tallImage = await sharp({
        create: {
          width: 100, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 },
        },
      }).png().toBuffer();
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/tall.png' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/tall.png') {
          return Promise.resolve(new Response(tallImage));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/jpeg');
    });

    it('pads too-wide source image without cropping', async () => {
      const wideImage = await sharp({
        create: {
          width: 300, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 },
        },
      }).png().toBuffer();
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/wide.png' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/wide.png') {
          return Promise.resolve(new Response(wideImage));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/jpeg');
    });

    it('normalizes EXIF orientation and pads rotated source image without cropping', async () => {
      const rotatedImage = await sharp({
        create: {
          width: 300, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 },
        },
      }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/rotated.jpg' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/rotated.jpg') {
          return Promise.resolve(new Response(rotatedImage));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/jpeg');
    });

    it('502s when source image fetch fails', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue', announceImageUrl: 'https://example.com/missing.jpg' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/missing.jpg') {
          return Promise.resolve(new Response('Not Found', { status: 404 }));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(502);
      expect(r.body.message).toBe('source image could not be fetched or read');
    });

    it('502s when source image contains unreadable bytes', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue', announceImageUrl: 'https://example.com/corrupt.jpg' });
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        if (String(url) === 'https://example.com/corrupt.jpg') {
          return Promise.resolve(new Response(Buffer.from('corrupt non-image')));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(502);
      expect(r.body.message).toBe('source image could not be fetched or read');
    });

    it('serves default promo image when gig has neither announceImageUrl nor promoImageUrl', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      r = await request(app)
        .get(`/gig/${gig._id}/announce-image.jpg`)
        .set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/jpeg');
    });

    it('500s when database query throws', async () => {
      vi.spyOn(GigModel, 'findById').mockRejectedValueOnce(new Error('db error'));
      r = await request(app)
        .get('/gig/6ae4fa4e3ad5019fd1248d7b/announce-image.jpg')
        .set({ origin: allowedUrl });
      expect(r.status).toBe(500);
      expect(r.body.message).toBe('db error');
    });
  });

  describe('POST /gig/:id/announce (#962)', () => {
    const META_ENV_KEYS = ['META_IG_USER_ID', 'META_IG_ACCESS_TOKEN'] as const;
    let originalEnv: Record<string, string | undefined>;

    beforeEach(async () => {
      originalEnv = {};
      for (const k of META_ENV_KEYS) originalEnv[k] = process.env[k];
      process.env.META_IG_USER_ID = 'ig-user-1';
      process.env.META_IG_ACCESS_TOKEN = 'ig-token';
    });

    afterEach(async () => {
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

    it('publishes Instagram with tags through v25.0 and stamps announcedAt', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/promo.jpg' });
      // Only intercept calls to Meta's Graph API — the api.ts test helper
      // itself uses fetch() to hit the local ephemeral test server, and that
      // MUST reach the real fetch or the request never actually happens.
      const realFetch = global.fetch;
      vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        const urlStr = String(url);
        if (urlStr.startsWith('https://graph.facebook.com/v25.0/')) {
          if (urlStr.startsWith('https://graph.facebook.com/v25.0/container-1?')) return Promise.resolve(Response.json({ status_code: 'FINISHED' }));
          return Promise.resolve(Response.json({ id: urlStr.endsWith('/media_publish') ? 'media-1' : 'container-1' }));
        }
        return realFetch(url, init);
      });

      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: '<p>Big show tonight!</p>', userTags: ['chemmariasherman', 'venue'] });

      expect(r.status).toBe(200);
      expect(r.body).toEqual({ instagram: { ok: true, id: 'media-1' } });
      const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('https://graph.facebook.com/'));
      expect(calls).toHaveLength(3);
      expect(String(calls[1][0])).toMatch(/\/container-1\?fields=status_code%2Cstatus/);
      const form = new URLSearchParams(calls[0][1]?.body as string);
      expect(form.get('image_url')).toMatch(/\/gig\/[^/]+\/announce-image\.jpg$/);
      expect(JSON.parse(form.get('user_tags')!)).toEqual([
        { username: 'chemmariasherman', x: 0.25, y: 0.85 }, { username: 'venue', x: 0.75, y: 0.85 },
      ]);

      const updated = await GigModel.findById(String(gig._id));
      expect((updated as unknown as { announcedAt?: Date }).announcedAt).toBeTruthy();
      expect((updated as unknown as { announceImageUrl?: string }).announceImageUrl).toBe('https://example.com/promo.jpg');
    });

    it('records each successful picture and reports a dropped location through the HTTP route', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue', promoImageUrl: 'https://example.com/first.jpg' });
      expect(gig.announcements).toBeUndefined();
      let mediaCalls = 0;
      const http = vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
        const address = String(url);
        if (!address.startsWith('https://graph.facebook.com/')) return realFetch(url, init);
        if (address.endsWith('/media')) {
          mediaCalls += 1;
          if (mediaCalls === 1) return Promise.resolve(Response.json({ error: { message: 'Location refused' } }, { status: 400 }));
          return Promise.resolve(Response.json({ id: `container-${mediaCalls}` }));
        }
        return Promise.resolve(Response.json(address.endsWith('/media_publish') ? { id: 'post' } : { status_code: 'FINISHED' }));
      });
      for (const imageUrl of ['https://example.com/first.jpg', 'https://example.com/second.jpg']) {
        r = await request(app).post(`/gig/${gig._id}/announce`).set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
          .send({ caption: 'Hi', imageUrl, collaborators: ['chemmariasherman'], locationId: '378590115336095' });
        expect(r.status).toBe(200);
        expect(r.body.instagram).toEqual(imageUrl.endsWith('first.jpg')
          ? { ok: true, id: 'post', locationDropped: 'Location refused' } : { ok: true, id: 'post' });
      }
      const updated = await GigModel.findById(String(gig._id)) as unknown as {
        announcedAt: Date; announcements: { at: Date; imageUrl: string }[];
      };
      expect(updated.announcements.map((entry) => entry.imageUrl)).toEqual(['https://example.com/first.jpg', 'https://example.com/second.jpg']);
      expect(updated.announcements[0].at).toBeInstanceOf(Date);
      expect(updated.announcements[1].at).toEqual(updated.announcedAt);
      expect(updated.announcements[0]).not.toHaveProperty('_id');
      expect(http.mock.calls.filter(([url]) => String(url).endsWith('/media_publish'))).toHaveLength(2);
    });

    it('does not add history or stamp when both location attempts fail', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      const http = vi.spyOn(global, 'fetch').mockImplementation((url, init) => (
        String(url).startsWith('https://graph.facebook.com/')
          ? Promise.resolve(Response.json({ error: { message: 'Invalid image' } }, { status: 400 })) : realFetch(url, init)
      ));
      r = await request(app).post(`/gig/${gig._id}/announce`).set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: 'Hi', locationId: '123' });
      expect(r.body).toEqual({ instagram: { ok: false, error: 'Invalid image' } });
      const updated = await GigModel.findById(String(gig._id));
      expect(updated?.announcedAt).toBeUndefined();
      expect(updated?.announcements).toBeUndefined();
      expect(http.mock.calls.filter(([url]) => String(url).startsWith('https://graph.facebook.com/'))).toHaveLength(2);
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
      expect(r.body.message).toBe('Instagram announce is not configured');
    });

    it.each([
      ['META_IG_USER_ID'],
      ['META_IG_ACCESS_TOKEN'],
    ])('500s with a clear message when %s is absent', async (missingKey) => {
      delete process.env[missingKey];
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      r = await request(app)
        .post(`/gig/${gig._id}/announce`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: '<p>Hi</p>' });
      expect(r.status).toBe(500);
      expect(r.body.message).toBe('Instagram announce is not configured');
    });

    it.each([
      { userTags: ['@invalid'] }, { collaborators: ['bad name'] }, { collaborators: ['a', 'b', 'c', 'd'] },
      { locationId: '12a' }, { locationId: '-5' }, { locationId: '123456789012345678901' },
    ])('refuses malformed announce fields through HTTP without an Instagram request or gig update: %j', async (body) => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      const http = vi.spyOn(global, 'fetch');
      r = await request(app).post(`/gig/${gig._id}/announce`).set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: 'Hi', ...body });
      expect(r.status).toBe(400);
      expect(http.mock.calls.filter(([url]) => String(url).startsWith('https://graph.'))).toHaveLength(0);
      const updated = await GigModel.findById(String(gig._id));
      expect(updated?.announcedAt).toBeUndefined();
      expect(updated?.announceImageUrl).toBeUndefined();
      expect(updated?.announcements).toBeUndefined();
    });

    it('reports authorization lookup failure through the HTTP route without publishing', async () => {
      const gig = await GigModel.create({ venue: 'Announce Venue' });
      vi.spyOn(userModel, 'findById').mockRejectedValue(new Error('database unavailable'));
      const http = vi.spyOn(global, 'fetch');
      r = await request(app).post(`/gig/${gig._id}/announce`).set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send({ caption: 'Hi' });
      expect(r.status).toBe(500);
      expect(http.mock.calls.filter(([url]) => String(url).startsWith('https://graph.'))).toHaveLength(0);
      expect((await GigModel.findById(String(gig._id)))?.announcedAt).toBeUndefined();
    });

    it('reads both settings from the environment each time without database storage', async () => {
      expect(getInstagramKey()).toEqual({ userId: 'ig-user-1', accessToken: 'ig-token' });
      process.env.META_IG_ACCESS_TOKEN = 'obsolete-fixture-key';
      expect(getInstagramKey()?.accessToken).toBe('obsolete-fixture-key');
    });
  });

  it('should wait unit tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

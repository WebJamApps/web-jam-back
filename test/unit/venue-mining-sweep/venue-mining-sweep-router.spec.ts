import { vi } from 'vitest';
import app from '#src/index.js';
import venueMiningSweepModel from '#src/model/venue-mining-sweep/venue-mining-sweep-schema.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

interface CreatedUser {
  _id: { toString(): string };
}

describe('Venue Mining Sweep Router (/venue-mining/sweep)', () => {
  let r: ApiResponse;
  let agentUser: { _id: string };
  let adminUser: { _id: string };
  let devUser: { _id: string };
  let unauthorizedUser: { _id: string };
  let nonAdminUser: { _id: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];

  const validPayload = {
    metroSlug: 'charlottesville',
    sweptAt: '2026-09-16',
    publication: {
      name: 'C-VILLE Weekly (SceneThink calendar)',
      url: 'http://events.c-ville.com',
      api: 'scenethink-v1',
      type: 'scenethink',
    },
    coverageArea: ['charlottesville', 'crozet'],
    excludeKeywords: ['downtown mall', 'wtju'],
    venuesCreatedCount: 12,
    notes: 'initial sweep',
  };

  beforeEach(async () => {
    await venueMiningSweepModel.deleteMany({});
    await userModel.deleteMany({ email: /@example-sweep\.com$/ });

    const createdAgent = await userModel.create({
      name: 'agent-sweep-user',
      email: 'agent@example-sweep.com',
      privileges: ['venue-mining:create'],
    }) as unknown as CreatedUser;
    agentUser = { _id: createdAgent._id.toString() };

    const createdAdmin = await userModel.create({
      name: 'admin-sweep-user',
      email: 'admin@example-sweep.com',
      userType: 'JaM-admin',
    }) as unknown as CreatedUser;
    adminUser = { _id: createdAdmin._id.toString() };

    const createdDev = await userModel.create({
      name: 'dev-sweep-user',
      email: 'dev@example-sweep.com',
      userType: 'Developer',
    }) as unknown as CreatedUser;
    devUser = { _id: createdDev._id.toString() };

    const createdUnauthorized = await userModel.create({
      name: 'unauthorized-sweep-user',
      email: 'unauth@example-sweep.com',
      privileges: ['venue:create'],
    }) as unknown as CreatedUser;
    unauthorizedUser = { _id: createdUnauthorized._id.toString() };

    const createdNonAdmin = await userModel.create({
      name: 'subscriber-sweep-user',
      email: 'sub@example-sweep.com',
      userType: 'Subscriber',
    }) as unknown as CreatedUser;
    nonAdminUser = { _id: createdNonAdmin._id.toString() };
  });

  describe('POST /venue-mining/sweep', () => {
    it('creates a sweep record with all fields and returns 201', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(201);
      expect(r.body.metroSlug).toBe('charlottesville');
      expect(new Date(r.body.sweptAt).toISOString().slice(0, 10)).toBe('2026-09-16');
      expect(r.body.publication.name).toBe('C-VILLE Weekly (SceneThink calendar)');
      expect(r.body.publication.url).toBe('http://events.c-ville.com');
      expect(r.body.publication.api).toBe('scenethink-v1');
      expect(r.body.publication.type).toBe('scenethink');
      expect(r.body.coverageArea).toEqual(['charlottesville', 'crozet']);
      expect(r.body.excludeKeywords).toEqual(['downtown mall', 'wtju']);
      expect(r.body.venuesCreatedCount).toBe(12);
      expect(r.body.notes).toBe('initial sweep');
      expect(r.body.createdAt).toBeDefined();
    });

    it('creates a sweep record with minimal required fields and returns 201', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({
          metroSlug: 'roanoke',
          sweptAt: '2026-09-15',
          publication: {
            name: 'Roanoke Times',
            url: 'https://roanoke.com',
          },
          venuesCreatedCount: 0,
        });

      expect(r.status).toBe(201);
      expect(r.body.metroSlug).toBe('roanoke');
      expect(r.body.venuesCreatedCount).toBe(0);
      expect(r.body.coverageArea).toBeUndefined();
      expect(r.body.excludeKeywords).toBeUndefined();
      expect(r.body.notes).toBeUndefined();
      expect(r.body.createdAt).toBeDefined();
    });

    it('allows admin role fallback without explicit privileges (JaM-admin)', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(201);
    });

    it('allows admin role fallback without explicit privileges (Developer)', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: devUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(201);
    });

    it('returns 409 for duplicate metroSlug and sweptAt', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send(validPayload);
      expect(r.status).toBe(201);

      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(409);
      expect(r.body.message).toContain('already exists');
    });

    it('normalizes sweptAt timestamps to UTC midnight and returns 409 for duplicate calendar date', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, sweptAt: '2026-09-16' });
      expect(r.status).toBe(201);
      expect(r.body.sweptAt).toBe('2026-09-16T00:00:00.000Z');

      // Attempt second sweep for same metro on same calendar date with timestamp
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, sweptAt: '2026-09-16T14:02:00Z' });

      expect(r.status).toBe(409);
      expect(r.body.message).toContain('already exists');
    });

    it('rejects with 400 when body is not an object', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send('not-json-object');

      expect(r.status).toBe(400);
    });

    it('rejects with 400 when missing or empty metroSlug', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, metroSlug: '   ' });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('metroSlug is required');
    });

    it('rejects with 400 when sweptAt is missing or invalid date', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, sweptAt: 'invalid-date' });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('sweptAt must be a valid date');
    });

    it('rejects with 400 when publication is missing or not an object', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, publication: null });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('publication is required');
    });

    it('rejects with 400 when publication.name is missing', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, publication: { url: 'https://example.com' } });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('publication.name is required');
    });

    it('rejects with 400 when publication.url is missing', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, publication: { name: 'Pub Name' } });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('publication.url is required');
    });

    it('rejects with 400 when publication.api or type is not a string', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({
          ...validPayload,
          publication: { name: 'Pub', url: 'https://pub.com', api: 123 },
        });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('publication.api must be a string');
    });

    it('rejects with 400 when venuesCreatedCount is invalid', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, venuesCreatedCount: -5 });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('venuesCreatedCount must be an integer >= 0');

      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, venuesCreatedCount: 2.5 });

      expect(r.status).toBe(400);
    });

    it('rejects with 400 when coverageArea is not an array of strings', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, coverageArea: 'not-array' });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('coverageArea must be an array of strings');

      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, coverageArea: ['valid', 123] });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('coverageArea must be an array of strings');
    });

    it('rejects with 400 when excludeKeywords is not an array of strings', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, excludeKeywords: ['valid', null] });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('excludeKeywords must be an array of strings');
    });

    it('rejects with 400 when notes is not a string', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send({ ...validPayload, notes: 123 });

      expect(r.status).toBe(400);
      expect(r.body.message).toContain('notes must be a string');
    });

    it('guard outcome 2: refuses with 401 when no token is provided', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .send(validPayload);

      expect(r.status).toBe(401);
    });

    it('guard outcome 2: refuses with 401 when invalid token is provided', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', 'Bearer invalid.jwt.token')
        .send(validPayload);

      expect(r.status).toBe(401);
    });

    it('guard outcome 2: refuses with 403 when user lacks venue-mining:create capability', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: unauthorizedUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(403);
      expect(r.body.message).toContain('missing venue-mining:create capability');
    });

    it('guard outcome 2: refuses with 403 when user has neither capability nor admin role', async () => {
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: nonAdminUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(403);
      expect(r.body.message).toContain('not authorized for venue mining sweeps');
    });

    it('guard outcome 2: refuses with 401 when token user is not found in database', async () => {
      const missingId = '507f1f77bcf86cd799439011';
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: missingId })}`)
        .send(validPayload);

      expect(r.status).toBe(401);
      expect(r.body.message).toContain('user not found');
    });

    it('guard outcome 3: refuses with 500 when auth lookup fails on POST', async () => {
      vi.spyOn(userModel, 'findById').mockRejectedValueOnce(new Error('User lookup DB error'));
      r = await request(app)
        .post('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`)
        .send(validPayload);

      expect(r.status).toBe(500);
      expect(r.body.message).toBe('User lookup DB error');
      const count = await venueMiningSweepModel.countDocuments();
      expect(count).toBe(0);
      vi.restoreAllMocks();
    });
  });

  describe('GET /venue-mining/sweep', () => {
    beforeEach(async () => {
      await venueMiningSweepModel.create({
        metroSlug: 'charlottesville',
        sweptAt: new Date('2026-09-10'),
        publication: { name: 'C-VILLE 1', url: 'https://c-ville.com' },
        venuesCreatedCount: 5,
        createdAt: new Date('2026-09-10T12:00:00Z'),
      });
      await venueMiningSweepModel.create({
        metroSlug: 'charlottesville',
        sweptAt: new Date('2026-09-16'),
        publication: { name: 'C-VILLE 2', url: 'https://c-ville.com' },
        venuesCreatedCount: 8,
        createdAt: new Date('2026-09-16T12:00:00Z'),
      });
      await venueMiningSweepModel.create({
        metroSlug: 'roanoke',
        sweptAt: new Date('2026-09-12'),
        publication: { name: 'Roanoke Times', url: 'https://roanoke.com' },
        venuesCreatedCount: 3,
        createdAt: new Date('2026-09-12T12:00:00Z'),
      });
    });

    it('returns records newest first when no filter is provided', async () => {
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBe(3);
      // Newest first: 2026-09-16 -> 2026-09-12 -> 2026-09-10
      expect(new Date(r.body[0].sweptAt).getTime()).toBeGreaterThan(new Date(r.body[1].sweptAt).getTime());
      expect(new Date(r.body[1].sweptAt).getTime()).toBeGreaterThan(new Date(r.body[2].sweptAt).getTime());
      expect(r.body[0].metroSlug).toBe('charlottesville');
      expect(r.body[1].metroSlug).toBe('roanoke');
      expect(r.body[2].metroSlug).toBe('charlottesville');
    });

    it('filters by ?metroSlug=<slug> and returns records newest first', async () => {
      r = await request(app)
        .get('/venue-mining/sweep?metroSlug=charlottesville')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      expect(r.body.length).toBe(2);
      expect(r.body[0].metroSlug).toBe('charlottesville');
      expect(r.body[1].metroSlug).toBe('charlottesville');
      expect(new Date(r.body[0].sweptAt).getTime()).toBeGreaterThan(new Date(r.body[1].sweptAt).getTime());
      expect(r.body[0].venuesCreatedCount).toBe(8);
      expect(r.body[1].venuesCreatedCount).toBe(5);
    });

    it('allows admin role fallback for GET (JaM-admin)', async () => {
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(200);
      expect(r.body.length).toBe(3);
    });

    it('guard outcome 2: refuses GET with 401 when token is missing', async () => {
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl });

      expect(r.status).toBe(401);
    });

    it('guard outcome 2: refuses GET with 403 when user lacks capability', async () => {
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: unauthorizedUser._id })}`);

      expect(r.status).toBe(403);
    });

    it('guard outcome 2: refuses GET with 401 when token user does not exist', async () => {
      const missingId = '507f1f77bcf86cd799439011';
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: missingId })}`);

      expect(r.status).toBe(401);
    });

    it('guard outcome 3: refuses with 500 when auth lookup fails on GET', async () => {
      vi.spyOn(userModel, 'findById').mockRejectedValueOnce(new Error('User lookup DB error'));
      r = await request(app)
        .get('/venue-mining/sweep')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: agentUser._id })}`);

      expect(r.status).toBe(500);
      expect(r.body.message).toBe('User lookup DB error');
      vi.restoreAllMocks();
    });
  });
});

import app from '#src/index.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import { nominatimThrottle } from '#src/model/venue/venue-controller.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Nominatim Place Discovery Route — GET /venue/discover/place (#1219)', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls?.[0] || 'http://localhost:7878';
  const realFetch = globalThis.fetch.bind(globalThis);

  let adminUser: { _id: string };
  let devUser: { _id: string };
  let capabilityUser: { _id: string };
  let nonAdminUser: { _id: string };
  let rateLimitUser: { _id: string };

  const nominatimFetchMock = vi.fn();

  beforeAll(async () => {
    await userModel.deleteMany({ email: { $regex: /@discover-place-test\.example\.com$/ } });

    const admin = await userModel.create({
      name: 'admin-discover-place',
      email: 'admin@discover-place-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    adminUser = { _id: admin._id.toString() };

    const dev = await userModel.create({
      name: 'dev-discover-place',
      email: 'dev@discover-place-test.example.com',
      userType: 'Developer',
    }) as unknown as { _id: { toString(): string } };
    devUser = { _id: dev._id.toString() };

    const cap = await userModel.create({
      name: 'cap-discover-place',
      email: 'cap@discover-place-test.example.com',
      userType: 'Developer',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    capabilityUser = { _id: cap._id.toString() };

    const fan = await userModel.create({
      name: 'fan-discover-place',
      email: 'fan@discover-place-test.example.com',
      userType: 'Fan',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: fan._id.toString() };

    const rl = await userModel.create({
      name: 'ratelimit-discover-place',
      email: 'ratelimit@discover-place-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    rateLimitUser = { _id: rl._id.toString() };
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: { $regex: /@discover-place-test\.example\.com$/ } });
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    nominatimFetchMock.mockReset();
    nominatimThrottle.reset();
    nominatimThrottle.minIntervalMs = 0; // default to 0 for fast test suite execution, explicit tests re-enable

    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.startsWith('https://nominatim.openstreetmap.org')) {
        return nominatimFetchMock(urlStr, init);
      }
      return realFetch(url, init);
    });
  });

  afterEach(() => {
    nominatimThrottle.reset();
  });

  describe('Authorization and Admin Gate', () => {
    it('refuses with 401 when no token is provided', async () => {
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl });

      expect(r.status).toBe(401);
      expect(nominatimFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 403 when user has venue capabilities (agent login)', async () => {
      const token = authUtils.createJWT({ _id: capabilityUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
      expect(r.body.message).toBe('admin role required');
      expect(nominatimFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 403 when user is not an admin role (e.g. Fan)', async () => {
      const token = authUtils.createJWT({ _id: nonAdminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(403);
      expect(r.body.message).toBe('admin role required');
      expect(nominatimFetchMock).not.toHaveBeenCalled();
    });

    it('allows a privilege-less JaM-admin user', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ lat: '37.27', lon: '-79.94', display_name: 'Salem, VA' }],
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Salem')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.lat).toBe(37.27);
    });

    it('allows a privilege-less Developer user', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ lat: '37.27', lon: '-79.94', display_name: 'Salem, VA' }],
      });

      const token = authUtils.createJWT({ _id: devUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Salem')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body.lat).toBe(37.27);
    });
  });

  describe('Outcomes — place found, place not found, Nominatim unreachable', () => {
    it('returns 200 with coordinates and displayName when place is found', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{
          lat: '38.4493315',
          lon: '-78.8688833',
          display_name: 'Harrisonburg, Virginia, United States',
        }],
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Harrisonburg,+VA')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        lat: 38.4493315,
        lng: -78.8688833,
        displayName: 'Harrisonburg, Virginia, United States',
      });
      expect(nominatimFetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = nominatimFetchMock.mock.calls[0];
      expect(calledUrl).toContain('format=jsonv2');
      expect(calledUrl).toContain('limit=1');
      expect(calledUrl).toContain('countrycodes=us');
      expect(calledInit.headers['User-Agent']).toContain('web-jam-back');
    });

    it('returns 200 with no position when place is not found in Nominatim', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=NonExistentTown12345')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({});
      expect(r.body.lat).toBeUndefined();
      expect(r.body.lng).toBeUndefined();
    });

    it('returns 200 with no position when query string is empty or whitespace without calling Nominatim', async () => {
      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=   ')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({});
      expect(nominatimFetchMock).not.toHaveBeenCalled();
    });

    it('returns 200 with no position when query parameter is omitted', async () => {
      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({});
      expect(nominatimFetchMock).not.toHaveBeenCalled();
    });

    it('returns 502 when Nominatim answers with a server error (e.g. 503)', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toContain('Nominatim error');
    });

    it('returns 502 when Nominatim network request fails', async () => {
      nominatimFetchMock.mockRejectedValue(new Error('Network error: connect ECONNREFUSED'));

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Nominatim unreachable');
    });

    it('returns 502 when Nominatim request times out', async () => {
      const timeoutErr = new Error('The operation was aborted due to timeout');
      timeoutErr.name = 'TimeoutError';
      nominatimFetchMock.mockRejectedValue(timeoutErr);

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Nominatim request timed out');
    });

    it('returns 502 when Nominatim payload is unparseable JSON', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('Unexpected token in JSON'); },
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Nominatim unreachable');
    });

    it('returns 200 with no position when Nominatim returns non-numeric coordinates', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ lat: 'invalid-lat', lon: 'invalid-lon' }],
      });

      const token = authUtils.createJWT({ _id: adminUser._id });
      const r = await request(app)
        .get('/venue/discover/place?q=Roanoke')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({});
    });
  });

  describe('Rate Limiting', () => {
    it('enforces the one-request-a-second limit when calling Nominatim (#1219)', async () => {
      nominatimThrottle.minIntervalMs = 1000;

      const callTimestamps: number[] = [];
      nominatimFetchMock.mockImplementation(() => {
        callTimestamps.push(Date.now());
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ lat: '37.27', lon: '-79.94', display_name: 'Salem, VA' }],
        });
      });

      const token = authUtils.createJWT({ _id: adminUser._id });

      const [res1, res2] = await Promise.all([
        request(app)
          .get('/venue/discover/place?q=Roanoke')
          .set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${token}`),
        request(app)
          .get('/venue/discover/place?q=Salem')
          .set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${token}`),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(callTimestamps).toHaveLength(2);
      const diff = callTimestamps[1] - callTimestamps[0];
      // Allowing minor timer jitter in node event loop (>= 950ms)
      expect(diff).toBeGreaterThanOrEqual(950);
    });

    it('enforces the 60-requests-a-minute limit on the route (#1219)', async () => {
      nominatimFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ lat: '37.27', lon: '-79.94' }],
      });

      const token = authUtils.createJWT({ _id: rateLimitUser._id });

      let lastStatus = 0;
      for (let i = 1; i <= 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r: ApiResponse = await request(app)
          .get('/venue/discover/place?q=test')
          .set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${token}`);
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(200);

      const r61 = await request(app)
        .get('/venue/discover/place?q=test')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);
      expect(r61.status).toBe(429);
      expect(r61.body).toContain('Too many requests');
    });

    it('does not re-invoke a scheduled task when fn rejects (#1219)', async () => {
      let callCount = 0;
      const failingFn = vi.fn().mockImplementation(() => {
        callCount += 1;
        return Promise.reject(new Error('task failed'));
      });

      await expect(nominatimThrottle.schedule(failingFn)).rejects.toThrow('task failed');
      expect(callCount).toBe(1);
    });
  });
});

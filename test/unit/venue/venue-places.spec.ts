import app from '#src/index.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Google Places Address Lookup Routes (#1159)', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls?.[0] || 'http://localhost:7878';
  const testApiKey = 'test-google-places-key-secret-12345';
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GOOGLE_PLACES_API_KEY;

  let adminUser: { _id: string };
  let devUser: { _id: string };
  let capabilityUser: { _id: string };
  let nonAdminUser: { _id: string };
  let rateLimitUser: { _id: string };
  let rateLimitUser2: { _id: string };

  const googleFetchMock = vi.fn();

  beforeAll(async () => {
    await userModel.deleteMany({ email: { $regex: /@places-test\.example\.com$/ } });

    const admin = await userModel.create({
      name: 'admin-places',
      email: 'admin@places-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    adminUser = { _id: admin._id.toString() };

    const dev = await userModel.create({
      name: 'dev-places',
      email: 'dev@places-test.example.com',
      userType: 'Developer',
    }) as unknown as { _id: { toString(): string } };
    devUser = { _id: dev._id.toString() };

    const cap = await userModel.create({
      name: 'cap-places',
      email: 'cap@places-test.example.com',
      userType: 'Developer',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    capabilityUser = { _id: cap._id.toString() };

    const fan = await userModel.create({
      name: 'fan-places',
      email: 'fan@places-test.example.com',
      userType: 'Fan',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: fan._id.toString() };

    const rl = await userModel.create({
      name: 'ratelimit-places',
      email: 'ratelimit@places-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    rateLimitUser = { _id: rl._id.toString() };

    const rl2 = await userModel.create({
      name: 'ratelimit-places-2',
      email: 'ratelimit2@places-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    rateLimitUser2 = { _id: rl2._id.toString() };
  });

  afterAll(async () => {
    await userModel.deleteMany({ email: { $regex: /@places-test\.example\.com$/ } });
    if (originalApiKey !== undefined) {
      process.env.GOOGLE_PLACES_API_KEY = originalApiKey;
    } else {
      delete process.env.GOOGLE_PLACES_API_KEY;
    }
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = testApiKey;
    googleFetchMock.mockReset();

    vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.startsWith('https://places.googleapis.com')) {
        return googleFetchMock(urlStr, init);
      }
      return originalFetch(url, init);
    });
  });

  describe('GET /venue/places/suggest', () => {
    it('refuses with 401 when no token is provided', async () => {
      const r = await request(app)
        .get('/venue/places/suggest?input=101+Main')
        .set({ origin: allowedUrl });

      expect(r.status).toBe(401);
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 403 when user is capability-only (e.g. agent identity)', async () => {
      const r = await request(app)
        .get('/venue/places/suggest?input=101+Main')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: capabilityUser._id })}`);

      expect(r.status).toBe(403);
      expect(r.body.message).toContain('admin role required');
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 403 when user is not an admin role', async () => {
      const r = await request(app)
        .get('/venue/places/suggest?input=101+Main')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: nonAdminUser._id })}`);

      expect(r.status).toBe(403);
      expect(r.body.message).toContain('admin role required');
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 503 and fails closed when GOOGLE_PLACES_API_KEY is unset', async () => {
      delete process.env.GOOGLE_PLACES_API_KEY;

      const r = await request(app)
        .get('/venue/places/suggest?input=101+Main')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(503);
      expect(r.body.message).toBe('Address lookup is not configured');
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('returns 200 with mapped suggestions for an admin caller', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJ123',
                text: { text: '101 Main St, Salem, VA, USA' },
              },
            },
            {
              placePrediction: {
                place: 'places/ChIJ456',
                text: '102 Main St, Salem, VA, USA',
              },
            },
          ],
        }),
      });

      const r = await request(app)
        .get('/venue/places/suggest?input=101+Main&sessionToken=uuid-token-1&regionCode=us')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual([
        { placeId: 'ChIJ123', text: '101 Main St, Salem, VA, USA' },
        { placeId: 'ChIJ456', text: '102 Main St, Salem, VA, USA' },
      ]);

      expect(googleFetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = googleFetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe('https://places.googleapis.com/v1/places:autocomplete');
      expect((calledInit.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(testApiKey);
      expect((calledInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');

      const parsedBody = JSON.parse(calledInit.body as string);
      expect(parsedBody).toEqual({
        input: '101 Main',
        sessionToken: 'uuid-token-1',
        includedRegionCodes: ['us'],
      });
    });

    it('omits includedRegionCodes when regionCode is not provided', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ suggestions: [] }),
      });

      const r = await request(app)
        .get('/venue/places/suggest?input=Test')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: devUser._id })}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);

      const [, calledInit] = googleFetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(calledInit.body as string);
      expect(parsedBody.input).toBe('Test');
      expect(parsedBody.includedRegionCodes).toBeUndefined();
    });

    it('returns 502 with Google status text and never leaks key on Google error', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: { code: 400, message: `Invalid key: ${testApiKey}`, status: 'INVALID_ARGUMENT' },
        }),
      });

      const r = await request(app)
        .get('/venue/places/suggest?input=Fail')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Bad Request');
      expect(JSON.stringify(r.body)).not.toContain(testApiKey);
    });

    it('returns 502 with timeout message and never leaks key on Google 5-second timeout', async () => {
      const timeoutError = new Error('The operation timed out');
      timeoutError.name = 'TimeoutError';
      googleFetchMock.mockRejectedValueOnce(timeoutError);

      const r = await request(app)
        .get('/venue/places/suggest?input=Timeout')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toContain('timed out');
      expect(JSON.stringify(r.body)).not.toContain(testApiKey);
    });
  });

  describe('GET /venue/places/:placeId', () => {
    it('refuses with 401 when no token is provided', async () => {
      const r = await request(app)
        .get('/venue/places/ChIJ123')
        .set({ origin: allowedUrl });

      expect(r.status).toBe(401);
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 403 for capability-only caller', async () => {
      const r = await request(app)
        .get('/venue/places/ChIJ123')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: capabilityUser._id })}`);

      expect(r.status).toBe(403);
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('refuses with 503 when GOOGLE_PLACES_API_KEY is unset', async () => {
      delete process.env.GOOGLE_PLACES_API_KEY;

      const r = await request(app)
        .get('/venue/places/ChIJ123')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(503);
      expect(r.body.message).toBe('Address lookup is not configured');
      expect(googleFetchMock).not.toHaveBeenCalled();
    });

    it('returns 200 with mapped fields and exact coordinates for an admin caller', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          formattedAddress: '101 Main St, Salem, VA 24153, USA',
          location: {
            latitude: 37.2934,
            longitude: -80.0546,
          },
          addressComponents: [
            { types: ['street_number'], longText: '101', shortText: '101' },
            { types: ['route'], longText: 'Main Street', shortText: 'Main St' },
            { types: ['locality', 'political'], longText: 'Salem', shortText: 'Salem' },
            { types: ['administrative_area_level_1', 'political'], longText: 'Virginia', shortText: 'VA' },
            { types: ['country', 'political'], longText: 'United States', shortText: 'US' },
            { types: ['postal_code'], longText: '24153', shortText: '24153' },
          ],
        }),
      });

      const r = await request(app)
        .get('/venue/places/ChIJ123?sessionToken=uuid-token-2')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        formattedAddress: '101 Main St, Salem, VA 24153, USA',
        street: '101 Main Street',
        city: 'Salem',
        state: 'VA',
        country: 'US',
        zipCode: '24153',
        lat: 37.2934,
        lng: -80.0546,
      });

      expect(googleFetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = googleFetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe('https://places.googleapis.com/v1/places/ChIJ123?sessionToken=uuid-token-2');
      expect((calledInit.headers as Record<string, string>)['X-Goog-Api-Key']).toBe(testApiKey);
      expect((calledInit.headers as Record<string, string>)['X-Goog-FieldMask'])
        .toBe('formattedAddress,addressComponents,location');
    });

    it('returns 502 with Google status text and never leaks key on Google error', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: { code: 404, message: `Place not found: ${testApiKey}`, status: 'NOT_FOUND' },
        }),
      });

      const r = await request(app)
        .get('/venue/places/ChIJBadId')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Not Found');
      expect(JSON.stringify(r.body)).not.toContain(testApiKey);
    });

    it('returns 502 with timeout message and never leaks key on 5-second Google timeout', async () => {
      const timeoutError = new Error('The operation timed out');
      timeoutError.name = 'TimeoutError';
      googleFetchMock.mockRejectedValueOnce(timeoutError);

      const r = await request(app)
        .get('/venue/places/ChIJTimeout')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      expect(r.status).toBe(502);
      expect(r.body.message).toContain('timed out');
      expect(JSON.stringify(r.body)).not.toContain(testApiKey);
    });
  });

  describe('Routing (/venue/places/... not captured by /venue/:id)', () => {
    it('does not capture /venue/places/suggest as /venue/:id (#1159)', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ suggestions: [] }),
      });

      const r = await request(app)
        .get('/venue/places/suggest')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      // If captured by /:id, it would return 400 "Find id is invalid"
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    it('does not capture /venue/places/:placeId as /venue/:id (#1159)', async () => {
      googleFetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          formattedAddress: '101 Main St',
          addressComponents: [],
        }),
      });

      const r = await request(app)
        .get('/venue/places/some-custom-place-id')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminUser._id })}`);

      // If captured by /:id, "places" is not valid ObjectId -> 400 "Find id is invalid"
      expect(r.status).toBe(200);
      expect(r.body.formattedAddress).toBe('101 Main St');
    });
  });

  describe('Rate Limiting (at most 60 requests a minute per caller)', () => {
    it('returns 429 on the 61st request in a minute (#1159)', async () => {
      googleFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ suggestions: [] }),
      });

      const token = authUtils.createJWT({ _id: rateLimitUser._id });
      let lastStatus = 0;

      // Make 60 requests
      for (let i = 1; i <= 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r: ApiResponse = await request(app)
          .get('/venue/places/suggest?input=test')
          .set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${token}`);
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(200);

      // 61st request gets 429
      const r61 = await request(app)
        .get('/venue/places/suggest?input=test')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${token}`);

      expect(r61.status).toBe(429);
    });

    it('normalizes token before rate limiting so alternate accepted header forms with same JWT receive 429 across both endpoints (#1159, #1160)', async () => {
      googleFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          suggestions: [],
          formattedAddress: '101 Main St',
          addressComponents: [],
        }),
      });

      const token = authUtils.createJWT({ _id: rateLimitUser2._id });
      let lastStatus = 0;

      // Exhaust 60 requests with standard Bearer format
      for (let i = 1; i <= 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r: ApiResponse = await request(app)
          .get('/venue/places/suggest?input=test')
          .set({ origin: allowedUrl })
          .set('Authorization', `Bearer ${token}`);
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(200);

      // Verify alternate accepted header forms with the same JWT receive 429 across both lookup endpoints
      const rAltPrefixSuggest = await request(app)
        .get('/venue/places/suggest?input=test')
        .set({ origin: allowedUrl })
        .set('Authorization', `Anything1 ${token}`);
      expect(rAltPrefixSuggest.status).toBe(429);

      const rAltPrefixDetails = await request(app)
        .get('/venue/places/ChIJ123')
        .set({ origin: allowedUrl })
        .set('Authorization', `Anything2 ${token}`);
      expect(rAltPrefixDetails.status).toBe(429);

      const rBareSuggest = await request(app)
        .get('/venue/places/suggest?input=test')
        .set({ origin: allowedUrl })
        .set('Authorization', token);
      expect(rBareSuggest.status).toBe(429);

      const rBareDetails = await request(app)
        .get('/venue/places/ChIJ123')
        .set({ origin: allowedUrl })
        .set('Authorization', token);
      expect(rBareDetails.status).toBe(429);

      // A different caller with a distinct token still has their allowance available
      const devToken = authUtils.createJWT({ _id: devUser._id });
      const rOther = await request(app)
        .get('/venue/places/suggest?input=test')
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${devToken}`);
      expect(rOther.status).toBe(200);
    });
  });
});

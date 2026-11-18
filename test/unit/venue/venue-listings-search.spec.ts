import app from '#src/index.js';
import MapListing from '#src/model/venue/map-listing-schema.js';
import { MAP_LISTING_LOCK_ID } from '#src/model/venue/map-listing-refresh.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

describe('Listings Copy Search & Retired Google Routes (#1217)', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls?.[0] || 'http://localhost:7878';

  let adminUser: { _id: string };
  let devUser: { _id: string };
  let capabilityUser: { _id: string };
  let nonAdminUser: { _id: string };
  let rateLimitUser: { _id: string };

  const sampleNow = new Date('2026-11-01T12:00:00Z');
  const sampleListings = [
    {
      listingId: 'ov-ramkat',
      name: 'The Ramkat',
      street: '170 W 9th St',
      city: 'Winston-Salem',
      state: 'NC',
      zipCode: '27101',
      website: 'https://theramkat.com',
      kind: 'music_venue',
      location: { type: 'Point', coordinates: [-80.2442, 36.1039] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-ramkat-annex',
      name: 'Ramkat Annex',
      street: '172 W 9th St',
      city: 'Winston-Salem',
      state: 'NC',
      zipCode: '27101',
      website: '',
      kind: 'music_venue',
      location: { type: 'Point', coordinates: [-80.2443, 36.104] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-ramkat-lounge',
      name: 'Ramkat Lounge',
      street: '200 Main St',
      city: 'Salem',
      state: 'VA',
      zipCode: '24153',
      website: 'https://ramkatlounge.example',
      kind: 'lounge',
      location: { type: 'Point', coordinates: [-80.0548, 37.2935] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-ram',
      name: 'The R & R Club',
      street: '55 Elm St',
      city: 'Roanoke',
      state: 'VA',
      zipCode: '24011',
      kind: 'bar',
      location: { type: 'Point', coordinates: [-79.9414, 37.271] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-spot',
      name: 'The Spot on Kirk',
      street: '22 S Kirk St',
      city: 'Roanoke',
      state: 'VA',
      zipCode: '24011',
      kind: 'music_venue',
      location: { type: 'Point', coordinates: [-79.9401, 37.2709] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-r-1',
      name: 'The Red Barn',
      street: '1 Oak Ave',
      city: 'Blacksburg',
      state: 'VA',
      zipCode: '24060',
      kind: 'brewery',
      location: { type: 'Point', coordinates: [-80.4139, 37.2296] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-r-2',
      name: 'The River Room',
      street: '2 River Rd',
      city: 'Radford',
      state: 'VA',
      zipCode: '24141',
      kind: 'bar',
      location: { type: 'Point', coordinates: [-80.5764, 37.1318] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-r-3',
      name: 'The Rooster Taproom',
      street: '3 Market St',
      city: 'Danville',
      state: 'VA',
      zipCode: '24541',
      kind: 'brewery',
      location: { type: 'Point', coordinates: [-79.395, 36.5859] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-the-r-4',
      name: 'The Rhythm Cellar',
      street: '4 Main St',
      city: 'Lynchburg',
      state: 'VA',
      zipCode: '24504',
      kind: 'music_venue',
      location: { type: 'Point', coordinates: [-79.1422, 37.4138] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-paren-brew',
      name: '(Brew House Live)',
      street: '10 Mill St',
      city: 'Salem',
      state: 'VA',
      zipCode: '24153',
      kind: 'brewery',
      location: { type: 'Point', coordinates: [-80.051, 37.291] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-dotstar',
      name: 'Club .* Soundstage',
      street: '20 Star Blvd',
      city: 'Roanoke',
      state: 'VA',
      zipCode: '24011',
      kind: 'music_venue',
      location: { type: 'Point', coordinates: [-79.94, 37.27] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
    {
      listingId: 'ov-obrien',
      name: "O'Brien's Public House",
      street: '30 Shamrock Way',
      city: 'Charlotte',
      state: 'NC',
      zipCode: '28202',
      kind: 'bar',
      location: { type: 'Point', coordinates: [-80.8431, 35.2271] },
      release: '2026-10-21.0',
      downloadedAt: sampleNow,
    },
  ];

  beforeAll(async () => {
    await userModel.deleteMany({ email: { $regex: /@listings-search-test\.example\.com$/ } });

    const admin = await userModel.create({
      name: 'admin-listings',
      email: 'admin@listings-search-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    adminUser = { _id: admin._id.toString() };

    const dev = await userModel.create({
      name: 'dev-listings',
      email: 'dev@listings-search-test.example.com',
      userType: 'Developer',
    }) as unknown as { _id: { toString(): string } };
    devUser = { _id: dev._id.toString() };

    const cap = await userModel.create({
      name: 'cap-listings',
      email: 'cap@listings-search-test.example.com',
      userType: 'Developer',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    capabilityUser = { _id: cap._id.toString() };

    const fan = await userModel.create({
      name: 'fan-listings',
      email: 'fan@listings-search-test.example.com',
      userType: 'Fan',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: fan._id.toString() };

    const rl = await userModel.create({
      name: 'ratelimit-listings',
      email: 'ratelimit@listings-search-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    rateLimitUser = { _id: rl._id.toString() };
  });

  afterAll(async () => {
    await MapListing.deleteMany({});
    await userModel.deleteMany({ email: { $regex: /@listings-search-test\.example\.com$/ } });
  });

  beforeEach(async () => {
    await MapListing.deleteMany({});
    await MapListing.insertMany(sampleListings);
  });

  afterEach(() => vi.restoreAllMocks());

  function adminHeaders(userId = adminUser._id, prefix = 'Bearer') {
    const token = authUtils.createJWT({ _id: userId });
    return { origin: allowedUrl, Authorization: `${prefix} ${token}` };
  }

  describe('Auth and admin-only checks', () => {
    it('answers 401 when the token is missing or invalid', async () => {
      const noAuth = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set({ origin: allowedUrl });
      expect(noAuth.status).toBe(401);

      const badAuth = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set({ origin: allowedUrl, Authorization: 'Bearer not-a-jwt' });
      expect(badAuth.status).toBe(401);
    });

    it('answers 403 for non-admin users and capability-based agent logins', async () => {
      const fanRes = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders(nonAdminUser._id));
      expect(fanRes.status).toBe(403);

      const capRes = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders(capabilityUser._id));
      expect(capRes.status).toBe(403);
    });

    it('allows JaM-admin and Developer logins with no capabilities list', async () => {
      const rAdmin = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders(adminUser._id));
      expect(rAdmin.status).toBe(200);

      const rDev = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders(devUser._id));
      expect(rDev.status).toBe(200);
    });
  });

  describe('Outcome table and matching rules', () => {
    it('returns [] with no database read when q is empty or under two characters', async () => {
      const findOneSpy = vi.spyOn(MapListing, 'findOne');
      const findSpy = vi.spyOn(MapListing, 'find');
      const aggregateSpy = vi.spyOn(MapListing, 'aggregate');

      for (const query of ['', 'a', '   ']) {
        // eslint-disable-next-line no-await-in-loop
        const r = await request(app)
          .get('/venue/listings/search')
          .query({ q: query })
          .set(adminHeaders());
        expect(r.status).toBe(200);
        expect(r.body).toEqual([]);
      }
      const rOmitted = await request(app)
        .get('/venue/listings/search')
        .set(adminHeaders());
      expect(rOmitted.status).toBe(200);
      expect(rOmitted.body).toEqual([]);

      expect(findOneSpy).not.toHaveBeenCalled();
      expect(findSpy).not.toHaveBeenCalled();
      expect(aggregateSpy).not.toHaveBeenCalled();
    });

    it('returns 503 when the listings copy has never been loaded (empty or lock doc only)', async () => {
      await MapListing.deleteMany({});
      await MapListing.collection.insertOne({
        listingId: MAP_LISTING_LOCK_ID,
        lockOwner: null,
        lockEpoch: 1,
        lockExpiresAt: new Date(0),
      });

      const r = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders());
      expect(r.status).toBe(503);
      expect(r.body.message).toBe('Venue listings have not loaded yet');
    });

    it('returns 502 when the database cannot be read', async () => {
      vi.spyOn(MapListing, 'findOne').mockImplementation(() => {
        throw new Error('connection dropped');
      });

      const r = await request(app)
        .get('/venue/listings/search?q=ramkat')
        .set(adminHeaders());
      expect(r.status).toBe(502);
      expect(r.body.message).toBe('Address lookup is unavailable');
    });

    it('ranks start-of-name prefix matches ahead of word matches and returns no listing twice', async () => {
      const r = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'ramkat' })
        .set(adminHeaders());
      expect(r.status).toBe(200);
      const items = r.body as Array<{ listingId: string; name: string; lat: number; lng: number; website: string }>;
      expect(items.map((item) => item.listingId)).toEqual([
        'ov-ramkat-annex',
        'ov-ramkat-lounge',
        'ov-ramkat',
      ]);
      expect(items[0]).toEqual({
        listingId: 'ov-ramkat-annex',
        name: 'Ramkat Annex',
        street: '172 W 9th St',
        city: 'Winston-Salem',
        state: 'NC',
        zipCode: '27101',
        website: '',
        lat: 36.104,
        lng: -80.2443,
      });
      expect(items[2].website).toBe('https://theramkat.com');
    });

    it('matches words split across venue name and city for "ramkat winston"', async () => {
      const r = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'ramkat winston' })
        .set(adminHeaders());
      expect(r.status).toBe(200);
      const items = r.body as Array<{ listingId: string; name: string }>;
      expect(items.map((item) => item.listingId)).toEqual([
        'ov-ramkat',
        'ov-ramkat-annex',
      ]);
    });

    it('caps "the r" at five items with start-of-name prefix matches before word matches and no duplicates', async () => {
      const r = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'the r' })
        .set(adminHeaders());
      expect(r.status).toBe(200);
      const items = r.body as Array<{ listingId: string; name: string }>;
      expect(items).toHaveLength(5);
      expect(new Set(items.map((item) => item.listingId)).size).toBe(5);
      expect(items[0].listingId).toBe('ov-ramkat');
      for (const item of items) {
        expect(item.name.toLowerCase().startsWith('the r')).toBe(true);
      }
    });

    it('treats "(brew", ".*" and "O\'Brien\'s" as literal text rather than regex syntax', async () => {
      const paren = await request(app)
        .get('/venue/listings/search')
        .query({ q: '(brew' })
        .set(adminHeaders());
      expect(paren.status).toBe(200);
      expect((paren.body as Array<{ listingId: string }>).map((i) => i.listingId)).toEqual(['ov-paren-brew']);

      const dotStar = await request(app)
        .get('/venue/listings/search')
        .query({ q: '.*' })
        .set(adminHeaders());
      expect(dotStar.status).toBe(200);
      expect((dotStar.body as Array<{ listingId: string }>).map((i) => i.listingId)).toEqual(['ov-dotstar']);

      const obrien = await request(app)
        .get('/venue/listings/search')
        .query({ q: "O'Brien's" })
        .set(adminHeaders());
      expect(obrien.status).toBe(200);
      expect((obrien.body as Array<{ listingId: string }>).map((i) => i.listingId)).toEqual(['ov-obrien']);
    });

    it('ranks the best match first even when over 100 matching listings are inserted ahead of it', async () => {
      const fillerPrefix = Array.from({ length: 65 }, (_, i) => ({
        listingId: `ov-prefix-filler-${i}`,
        name: `Oakridge Tavern Number ${String(i).padStart(2, '0')}`,
        street: `${i + 1} Oak St`,
        city: 'Roanoke',
        state: 'VA',
        zipCode: '24011',
        kind: 'bar',
        location: { type: 'Point', coordinates: [-79.94, 37.27] },
        release: '2026-10-21.0',
        downloadedAt: sampleNow,
      }));
      const exactPrefixLast = {
        listingId: 'ov-zz-prefix-exact-last',
        name: 'Oakridge',
        street: '999 Oak St',
        city: 'Roanoke',
        state: 'VA',
        zipCode: '24011',
        kind: 'bar',
        location: { type: 'Point', coordinates: [-79.94, 37.27] },
        release: '2026-10-21.0',
        downloadedAt: sampleNow,
      };

      const fillerWords = Array.from({ length: 115 }, (_, i) => ({
        listingId: `ov-word-filler-${i}`,
        name: `Northside Cedar Venue ${String(i).padStart(3, '0')}`,
        street: `${i + 1} Cedar Ave`,
        city: 'Blacksburg',
        state: 'VA',
        zipCode: '24060',
        kind: 'bar',
        location: { type: 'Point', coordinates: [-80.41, 37.22] },
        release: '2026-10-21.0',
        downloadedAt: sampleNow,
      }));
      const bestWordLast = {
        listingId: 'ov-zz-word-best-last',
        name: 'The Cedar Blacksburg Lounge',
        street: '500 Main St',
        city: 'Salem',
        state: 'VA',
        zipCode: '24153',
        kind: 'lounge',
        location: { type: 'Point', coordinates: [-80.05, 37.29] },
        release: '2026-10-21.0',
        downloadedAt: sampleNow,
      };

      await MapListing.insertMany([...fillerPrefix, exactPrefixLast, ...fillerWords, bestWordLast]);

      const prefixRes = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'oakridge' })
        .set(adminHeaders());
      expect(prefixRes.status).toBe(200);
      const prefixItems = prefixRes.body as Array<{ listingId: string }>;
      expect(prefixItems).toHaveLength(5);
      expect(prefixItems[0].listingId).toBe('ov-zz-prefix-exact-last');

      const wordRes = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'cedar blacksburg' })
        .set(adminHeaders());
      expect(wordRes.status).toBe(200);
      const wordItems = wordRes.body as Array<{ listingId: string }>;
      expect(wordItems).toHaveLength(5);
      expect(wordItems[0].listingId).toBe('ov-zz-word-best-last');
    });

    it('awards word-boundary bonus when a word matches mid-word first and standalone later', async () => {
      await MapListing.insertMany([
        {
          listingId: 'ov-rambar-short',
          name: 'Rambar X',
          street: '10 Main St',
          city: 'Roanoke',
          state: 'VA',
          zipCode: '24011',
          kind: 'bar',
          location: { type: 'Point', coordinates: [-79.94, 37.27] },
          release: '2026-10-21.0',
          downloadedAt: sampleNow,
        },
        {
          listingId: 'ov-rambar-bar',
          name: 'Rambar Bar',
          street: '12 Main St',
          city: 'Roanoke',
          state: 'VA',
          zipCode: '24011',
          kind: 'bar',
          location: { type: 'Point', coordinates: [-79.94, 37.27] },
          release: '2026-10-21.0',
          downloadedAt: sampleNow,
        },
      ]);

      const r = await request(app)
        .get('/venue/listings/search')
        .query({ q: 'bar' })
        .set(adminHeaders());
      expect(r.status).toBe(200);
      const items = r.body as Array<{ listingId: string }>;
      expect(items.map((i) => i.listingId)).toEqual(['ov-rambar-bar', 'ov-the-r-1', 'ov-rambar-short']);
    });
  });

  describe('Rate limit (60 requests per minute keyed on Authorization header)', { timeout: 15000 }, () => {
    it('returns 429 on the 61st request for one Authorization header while allowing another header', async () => {
      const headersA = adminHeaders(rateLimitUser._id, 'Bearer');
      const headersB = adminHeaders(rateLimitUser._id, 'Token');
      let lastStatus = 0;

      for (let i = 1; i <= 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r: ApiResponse = await request(app)
          .get('/venue/listings/search?q=a')
          .set(headersA);
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(200);

      const r61 = await request(app)
        .get('/venue/listings/search?q=a')
        .set(headersA);
      expect(r61.status).toBe(429);

      const rDistinctHeader = await request(app)
        .get('/venue/listings/search?q=a')
        .set(headersB);
      expect(rDistinctHeader.status).toBe(200);
    });
  });

  describe('Retired Google Places routes return 404', () => {
    it('answers 404 on GET /venue/places/suggest and GET /venue/places/:placeId', async () => {
      const suggestRes = await request(app)
        .get('/venue/places/suggest?input=test')
        .set(adminHeaders());
      expect(suggestRes.status).toBe(404);

      const detailsRes = await request(app)
        .get('/venue/places/ChIJ123')
        .set(adminHeaders());
      expect(detailsRes.status).toBe(404);
    });
  });
});

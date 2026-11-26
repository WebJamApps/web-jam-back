import app from '#src/index.js';
import MapListing from '#src/model/venue/map-listing-schema.js';
import MapListingRejection from '#src/model/venue/map-listing-rejection-schema.js';
import { MAP_LISTING_LOCK_ID, MAP_LISTING_MAX_RADIUS_MILES } from '#src/model/venue/map-listing-refresh.js';
import type { DiscoverListingRow } from '#src/model/venue/discover-listings.js';
import venueModel from '#src/model/venue/venue-facade.js';
import VenueMiningSweep from '#src/model/venue-mining-sweep/venue-mining-sweep-schema.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../../helpers/api.js';

interface DiscoverResponseBody {
  rows: DiscoverListingRow[];
  lastDownloadedAt: string;
  copyRadiusMiles: number;
}

describe('Venue Discovery Search & Rejection Routes (#1215)', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls?.[0] || 'http://localhost:7878';

  let adminUser: { _id: string; email: string };
  let devUser: { _id: string; email: string };
  let capabilityUser: { _id: string };
  let nonAdminUser: { _id: string };
  let rateLimitUser: { _id: string };

  // Search center: Salem, VA (37.2935, -80.0548)
  const salemLat = 37.2935;
  const salemLng = -80.0548;
  const committedAt = new Date('2026-11-15T10:00:00.000Z');
  const downloadedAt = new Date('2026-11-15T09:55:00.000Z');

  function makeListing(overrides: {
    listingId: string;
    name: string;
    kind?: string;
    city?: string;
    state?: string;
    lng?: number;
    lat?: number;
    phone?: string;
    website?: string;
  }) {
    return {
      listingId: overrides.listingId,
      name: overrides.name,
      street: '100 Main St',
      city: overrides.city ?? 'Salem',
      state: overrides.state ?? 'VA',
      zipCode: '24153',
      phone: overrides.phone ?? '540-555-0100',
      website: overrides.website ?? 'https://example.com',
      kind: overrides.kind ?? 'bar',
      location: {
        type: 'Point' as const,
        coordinates: [overrides.lng ?? salemLng, overrides.lat ?? salemLat],
      },
      release: '2026-10-21.0',
      downloadedAt,
    };
  }

  function adminHeaders(userId = adminUser._id, prefix = 'Bearer') {
    const token = authUtils.createJWT({ _id: userId });
    return { origin: allowedUrl, Authorization: `${prefix} ${token}` };
  }

  async function seedLockDoc() {
    await MapListing.collection.insertOne({
      listingId: MAP_LISTING_LOCK_ID,
      lockOwner: null,
      lockEpoch: 1,
      lockExpiresAt: new Date(0),
      lastCommittedAt: committedAt,
    });
  }

  beforeAll(async () => {
    await MapListing.init();
    await MapListingRejection.init();
    await userModel.deleteMany({ email: { $regex: /@venue-discover-test\.example\.com$/ } });

    const admin = await userModel.create({
      name: 'admin-discover',
      email: 'admin@venue-discover-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string }; email: string };
    adminUser = { _id: admin._id.toString(), email: admin.email };

    const dev = await userModel.create({
      name: 'dev-discover',
      email: 'dev@venue-discover-test.example.com',
      userType: 'Developer',
    }) as unknown as { _id: { toString(): string }; email: string };
    devUser = { _id: dev._id.toString(), email: dev.email };

    const cap = await userModel.create({
      name: 'cap-discover',
      email: 'cap@venue-discover-test.example.com',
      userType: 'Developer',
      privileges: ['venue:create', 'venue:edit', 'venue:delete'],
    }) as unknown as { _id: { toString(): string } };
    capabilityUser = { _id: cap._id.toString() };

    const fan = await userModel.create({
      name: 'fan-discover',
      email: 'fan@venue-discover-test.example.com',
      userType: 'Fan',
    }) as unknown as { _id: { toString(): string } };
    nonAdminUser = { _id: fan._id.toString() };

    const rl = await userModel.create({
      name: 'ratelimit-discover',
      email: 'ratelimit@venue-discover-test.example.com',
      userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    rateLimitUser = { _id: rl._id.toString() };
  });

  afterAll(async () => {
    await MapListing.deleteMany({});
    await MapListingRejection.deleteMany({});
    await venueModel.deleteMany({});
    await VenueMiningSweep.deleteMany({});
    await userModel.deleteMany({ email: { $regex: /@venue-discover-test\.example\.com$/ } });
  });

  beforeEach(async () => {
    await MapListing.deleteMany({});
    await MapListingRejection.deleteMany({});
    await venueModel.deleteMany({});
    await VenueMiningSweep.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Auth and admin-only checks across all three routes', () => {
    it('answers 401 when token is missing, invalid, or user is not found', async () => {
      for (const method of ['get', 'post', 'delete'] as const) {
        const path = method === 'get' ? `/venue/discover?lat=${salemLat}&lng=${salemLng}` : '/venue/discover/ov-1/reject';
        // eslint-disable-next-line no-await-in-loop
        const missing = await request(app)[method](path).set({ origin: allowedUrl });
        expect(missing.status).toBe(401);

        // eslint-disable-next-line no-await-in-loop
        const bad = await request(app)[method](path).set({ origin: allowedUrl, Authorization: 'Bearer not-a-jwt' });
        expect(bad.status).toBe(401);
      }

      const missingUserToken = authUtils.createJWT({ _id: '507f1f77bcf86cd799439011' });
      const unknownUserRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set({ origin: allowedUrl, Authorization: `Bearer ${missingUserToken}` });
      expect(unknownUserRes.status).toBe(401);
    });

    it('answers 403 for non-admin users and capability-based logins', async () => {
      for (const userId of [nonAdminUser._id, capabilityUser._id]) {
        // eslint-disable-next-line no-await-in-loop
        const g = await request(app).get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`).set(adminHeaders(userId));
        expect(g.status).toBe(403);
        expect(g.body.message).toBe('admin role required');

        // eslint-disable-next-line no-await-in-loop
        const p = await request(app).post('/venue/discover/ov-1/reject').set(adminHeaders(userId));
        expect(p.status).toBe(403);

        // eslint-disable-next-line no-await-in-loop
        const d = await request(app).delete('/venue/discover/ov-1/reject').set(adminHeaders(userId));
        expect(d.status).toBe(403);
      }
    });

    it('returns 500 when auth user lookup fails at the HTTP route level', async () => {
      vi.spyOn(userModel, 'findById').mockRejectedValue(new Error('auth db down'));

      const g = await request(app).get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`).set(adminHeaders());
      expect(g.status).toBe(500);

      const p = await request(app).post('/venue/discover/ov-1/reject').set(adminHeaders());
      expect(p.status).toBe(500);

      const d = await request(app).delete('/venue/discover/ov-1/reject').set(adminHeaders());
      expect(d.status).toBe(500);
    });

    it('allows privilege-less JaM-admin and Developer users', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-admin-ok', name: 'Salem Taproom' })]);

      const rAdmin = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders(adminUser._id));
      expect(rAdmin.status).toBe(200);

      const rDev = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders(devUser._id));
      expect(rDev.status).toBe(200);
    });
  });

  describe('Route outcomes table', () => {
    it('answers 400 when lat, lng, radiusMiles, or showRejected are missing or out of range', async () => {
      const invalidQueries = [
        {},
        { lat: salemLat },
        { lng: salemLng },
        { lat: 'abc', lng: salemLng },
        { lat: '91', lng: salemLng },
        { lat: '-90.1', lng: salemLng },
        { lat: salemLat, lng: '181' },
        { lat: salemLat, lng: '-180.1' },
        { lat: salemLat, lng: salemLng, radiusMiles: '4.9' },
        { lat: salemLat, lng: salemLng, radiusMiles: '100.1' },
        { lat: salemLat, lng: salemLng, radiusMiles: 'not-a-number' },
        { lat: salemLat, lng: salemLng, showRejected: 'maybe' },
      ];

      for (const q of invalidQueries) {
        // eslint-disable-next-line no-await-in-loop
        const r = await request(app).get('/venue/discover').query(q).set(adminHeaders());
        expect(r.status).toBe(400);
      }
    });

    it('answers 503 when the listings copy has never been loaded (empty or lock doc only)', async () => {
      await seedLockDoc();

      const g = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(g.status).toBe(503);
      expect(g.body.message).toBe('Venue listings have not loaded yet');

      const p = await request(app)
        .post('/venue/discover/ov-missing/reject')
        .set(adminHeaders());
      expect(p.status).toBe(503);
      expect(p.body.message).toBe('Venue listings have not loaded yet');

      const d = await request(app)
        .delete('/venue/discover/ov-missing/reject')
        .set(adminHeaders());
      expect(d.status).toBe(503);
      expect(d.body.message).toBe('Venue listings have not loaded yet');
    });

    it('answers 502 and fails closed when the venue list cannot be read', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-1', name: 'Open Taproom' })]);
      vi.spyOn(venueModel, 'find').mockRejectedValue(new Error('venue read failed'));

      const r = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(r.status).toBe(502);
      expect(r.body.rows).toBeUndefined();
    });

    it('answers 502 and fails closed when the rejection list cannot be read', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-1', name: 'Open Taproom' })]);
      vi.spyOn(MapListingRejection, 'find').mockImplementation(() => {
        throw new Error('rejection read failed');
      });

      const r = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(r.status).toBe(502);
      expect(r.body.rows).toBeUndefined();
    });

    it('answers 502 and fails closed when sweep excludeKeywords cannot be read', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-1', name: 'Open Taproom' })]);
      vi.spyOn(VenueMiningSweep, 'find').mockImplementation(() => {
        throw new Error('sweep read failed');
      });

      const r = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(r.status).toBe(502);
      expect(r.body.rows).toBeUndefined();
    });

    it('answers 502 when MapListing copy check fails', async () => {
      vi.spyOn(MapListing, 'findOne').mockImplementation(() => {
        throw new Error('mapListing read failed');
      });

      const g = await request(app).get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`).set(adminHeaders());
      expect(g.status).toBe(502);

      const p = await request(app).post('/venue/discover/ov-1/reject').set(adminHeaders());
      expect(p.status).toBe(502);

      const d = await request(app).delete('/venue/discover/ov-1/reject').set(adminHeaders());
      expect(d.status).toBe(502);
    });

    it('answers 404 on POST /reject for unknown listing ID and DELETE /reject for unknown rejection', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-known', name: 'Known Bar' })]);

      const postUnknown = await request(app)
        .post('/venue/discover/ov-does-not-exist/reject')
        .set(adminHeaders());
      expect(postUnknown.status).toBe(404);

      const delUnknown = await request(app)
        .delete('/venue/discover/ov-known/reject')
        .set(adminHeaders());
      expect(delUnknown.status).toBe(404);
    });

    it('answers 400 on whitespace or lock-id listingId on reject routes', async () => {
      const postSpace = await request(app)
        .post('/venue/discover/%20/reject')
        .set(adminHeaders());
      expect(postSpace.status).toBe(400);

      const delLock = await request(app)
        .delete(`/venue/discover/${MAP_LISTING_LOCK_ID}/reject`)
        .set(adminHeaders());
      expect(delLock.status).toBe(400);
    });
  });

  describe('Distance sorting, 9 kinds, radius default (25) & bounds, and copy metadata', () => {
    it('returns the nine discover kinds sorted nearest first within default 25 miles, with lastDownloadedAt and copyRadiusMiles', async () => {
      await seedLockDoc();
      await MapListing.insertMany([
        // 0 miles (Salem) — kind 'brewery'
        makeListing({
          listingId: 'ov-near',
          name: 'Salem Brewery',
          kind: 'brewery',
          lng: -80.0548,
          lat: 37.2935,
          phone: '540-555-0001',
          website: 'https://salembrew.example',
        }),
        // ~7 miles (Roanoke) — kind 'music_venue'
        makeListing({
          listingId: 'ov-mid',
          name: 'Roanoke Music Hall',
          kind: 'music_venue',
          city: 'Roanoke',
          lng: -79.9414,
          lat: 37.271,
        }),
        // ~20 miles (Blacksburg) — kind 'winery'
        makeListing({
          listingId: 'ov-edge-in',
          name: 'Blacksburg Winery',
          kind: 'winery',
          city: 'Blacksburg',
          lng: -80.4139,
          lat: 37.2296,
        }),
        // ~35 miles (Lynchburg) — outside default 25mi, inside 100mi
        makeListing({
          listingId: 'ov-far',
          name: 'Lynchburg Distillery',
          kind: 'distillery',
          city: 'Lynchburg',
          lng: -79.1422,
          lat: 37.4138,
        }),
        // Excluded kind: restaurant (within 0 miles)
        makeListing({
          listingId: 'ov-restaurant',
          name: 'Salem Bistro',
          kind: 'restaurant',
          lng: -80.0548,
          lat: 37.2935,
        }),
        // Excluded kind: theatre_venue (within 0 miles)
        makeListing({
          listingId: 'ov-theatre-kind',
          name: 'Salem Stage',
          kind: 'theatre_venue',
          lng: -80.0548,
          lat: 37.2935,
        }),
      ]);

      const defaultRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(defaultRes.status).toBe(200);
      const body = defaultRes.body as DiscoverResponseBody;
      expect(body.lastDownloadedAt).toBe(committedAt.toISOString());
      expect(body.copyRadiusMiles).toBe(MAP_LISTING_MAX_RADIUS_MILES);
      expect(body.rows.map((r) => r.listingId)).toEqual(['ov-near', 'ov-mid', 'ov-edge-in']);
      expect(body.rows[0]).toEqual({
        listingId: 'ov-near',
        name: 'Salem Brewery',
        kind: 'brewery',
        street: '100 Main St',
        city: 'Salem',
        state: 'VA',
        zipCode: '24153',
        phone: '540-555-0001',
        website: 'https://salembrew.example',
        lat: 37.2935,
        lng: -80.0548,
        distanceMiles: 0,
        rejected: false,
      });
      expect(body.rows[1].distanceMiles).toBeGreaterThan(body.rows[0].distanceMiles);
      expect(body.rows[2].distanceMiles).toBeGreaterThan(body.rows[1].distanceMiles);

      // Radius 100 includes Lynchburg (~50 miles away), radius 5 excludes Roanoke (~7 miles away)
      const wideRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}&radiusMiles=100`)
        .set(adminHeaders());
      expect(wideRes.status).toBe(200);
      expect((wideRes.body as DiscoverResponseBody).rows.map((r) => r.listingId)).toEqual([
        'ov-near',
        'ov-mid',
        'ov-edge-in',
        'ov-far',
      ]);

      const tightRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}&radiusMiles=5`)
        .set(adminHeaders());
      expect(tightRes.status).toBe(200);
      expect((tightRes.body as DiscoverResponseBody).rows.map((r) => r.listingId)).toEqual(['ov-near']);
    });

    it('falls back to listing downloadedAt when lock doc has no lastCommittedAt', async () => {
      await MapListing.insertMany([makeListing({ listingId: 'ov-no-lock', name: 'Salem Lounge', kind: 'lounge' })]);
      const r = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(r.status).toBe(200);
      const body = r.body as DiscoverResponseBody;
      expect(body.lastDownloadedAt).toBe(downloadedAt.toISOString());
      expect(body.rows.map((row) => row.listingId)).toEqual(['ov-no-lock']);
    });
  });

  describe('Closed case list: removing rows from a search', () => {
    it('enforces every literal row of the closed case list plus sweep excludeKeywords', async () => {
      await seedLockDoc();

      // Existing DB venues: active and archived Parkway Brewing in Salem, and Starr Hill Brewing in Crozet
      await venueModel.create({
        name: 'Starr Hill Brewing',
        address: '5391 Three Notchd Rd',
        city: 'Crozet',
        usState: 'VA',
        status: 'active',
      });
      await venueModel.create({
        name: 'Parkway Brewing',
        address: '739 Kessler Mill Rd',
        city: 'Salem',
        usState: 'VA',
        status: 'active',
      });
      await venueModel.create({
        name: 'Parkway Brewing',
        address: '741 Kessler Mill Rd',
        city: 'Blacksburg',
        usState: 'VA',
        status: 'archived',
      });

      // Sweep history excludeKeywords across any metro
      await VenueMiningSweep.create({
        metroSlug: 'roanoke-va',
        sweptAt: new Date('2026-11-01T00:00:00Z'),
        publication: { name: 'Roanoke Events', url: 'https://example.com' },
        venuesCreatedCount: 0,
        excludeKeywords: ['elks lodge'],
      });

      await MapListing.insertMany([
        makeListing({ listingId: 'ov-macarena', name: 'Macarena Grill' }),
        makeListing({ listingId: 'ov-grandin', name: 'Grandin Theatre' }),
        makeListing({ listingId: 'ov-berglund', name: 'Berglund Center Pavilion' }),
        makeListing({ listingId: 'ov-theater-bar', name: 'The Theater Bar' }),
        makeListing({
          listingId: 'ov-starr-hill',
          name: 'Starr Hill Pilot Brewery & Side Stage',
          kind: 'brewery',
          city: 'Roanoke',
        }),
        makeListing({
          listingId: 'ov-parkway-active',
          name: 'Parkway Brewing Company',
          kind: 'brewery',
          city: 'Salem',
        }),
        makeListing({
          listingId: 'ov-parkway-archived',
          name: 'Parkway Brewing Company',
          kind: 'brewery',
          city: 'Blacksburg',
        }),
        makeListing({ listingId: 'ov-sharkeys', name: "Sharkey's", city: 'Radford' }),
        makeListing({ listingId: 'ov-elks', name: 'Salem Elks Lodge 305', city: 'Salem' }),
        makeListing({ listingId: 'ov-church', name: 'Old Church Pub', city: 'Salem' }),
      ]);

      // Reject Sharkey's via POST /venue/discover/:listingId/reject
      const rejectRes = await request(app)
        .post('/venue/discover/ov-sharkeys/reject')
        .set(adminHeaders());
      expect(rejectRes.status).toBe(201);
      expect(rejectRes.body.listingId).toBe('ov-sharkeys');
      expect(rejectRes.body.name).toBe("Sharkey's");
      expect(rejectRes.body.rejectedBy).toBe(adminUser.email);
      expect(typeof rejectRes.body.rejectedAt).toBe('string');

      // Re-rejecting is idempotent and returns 200
      const reRejectRes = await request(app)
        .post('/venue/discover/ov-sharkeys/reject')
        .set(adminHeaders());
      expect(reRejectRes.status).toBe(200);

      // showRejected=false (default): Macarena Grill & Starr Hill kept; Theatre/Pavilion/Theater/Parkway active & archived/Sharkey's/Elks/Church removed
      const hideRejectedRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}&showRejected=false`)
        .set(adminHeaders());
      expect(hideRejectedRes.status).toBe(200);
      const hiddenRows = (hideRejectedRes.body as DiscoverResponseBody).rows;
      expect(hiddenRows.map((r) => r.name)).toEqual([
        'Macarena Grill',
        'Starr Hill Pilot Brewery & Side Stage',
      ]);
      expect(hiddenRows.every((r) => r.rejected === false)).toBe(true);

      // showRejected=true: Sharkey's is kept and marked rejected: true
      const showRejectedRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}&showRejected=true`)
        .set(adminHeaders());
      expect(showRejectedRes.status).toBe(200);
      const shownRows = (showRejectedRes.body as DiscoverResponseBody).rows;
      expect(shownRows.map((r) => r.name)).toEqual([
        'Macarena Grill',
        "Sharkey's",
        'Starr Hill Pilot Brewery & Side Stage',
      ]);
      const sharkeysRow = shownRows.find((r) => r.listingId === 'ov-sharkeys');
      expect(sharkeysRow?.rejected).toBe(true);

      // DELETE /venue/discover/ov-sharkeys/reject undoes the rejection
      const undoRes = await request(app)
        .delete('/venue/discover/ov-sharkeys/reject')
        .set(adminHeaders());
      expect(undoRes.status).toBe(200);
      expect(undoRes.body).toEqual({ listingId: 'ov-sharkeys', deleted: true });

      const afterUndoRes = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(adminHeaders());
      expect(afterUndoRes.status).toBe(200);
      const afterUndoRows = (afterUndoRes.body as DiscoverResponseBody).rows;
      expect(afterUndoRows.map((r) => r.name)).toEqual([
        'Macarena Grill',
        "Sharkey's",
        'Starr Hill Pilot Brewery & Side Stage',
      ]);
      expect(afterUndoRows.find((r) => r.listingId === 'ov-sharkeys')?.rejected).toBe(false);
    });
  });

  describe('Rate limit (60 requests per minute)', { timeout: 15000 }, () => {
    it('returns 429 on the 61st request for one Authorization header', async () => {
      await seedLockDoc();
      await MapListing.insertMany([makeListing({ listingId: 'ov-rl', name: 'Rate Limit Taproom' })]);

      const headersA = adminHeaders(rateLimitUser._id, 'Bearer');
      const headersB = adminHeaders(rateLimitUser._id, 'Token');
      let lastStatus = 0;

      for (let i = 1; i <= 60; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r: ApiResponse = await request(app)
          .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
          .set(headersA);
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(200);

      const r61 = await request(app)
        .get(`/venue/discover?lat=${salemLat}&lng=${salemLng}`)
        .set(headersA);
      expect(r61.status).toBe(429);

      const rDistinctHeader = await request(app)
        .post('/venue/discover/ov-rl/reject')
        .set(headersB);
      expect(rDistinctHeader.status).toBe(201);
    });
  });
});

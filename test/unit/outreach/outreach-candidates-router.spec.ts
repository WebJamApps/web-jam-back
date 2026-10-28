import app from '#src/index.js';
import venueModel from '#src/model/venue/venue-facade.js';
import gigModel from '#src/model/gig/gig-facade.js';
import outreachModel from '#src/model/outreach/outreach-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import { DEFAULT_ARTIST } from '#src/lib/artist.js';
import request from '../../helpers/api.js';

describe('GET /outreach/candidates radius search', () => {
  const city = 'Radius Test City';
  const location = { type: 'Point', coordinates: [-80.06, 37.27] };
  const radius = { lat: '37.27', lng: '-80.06', radiusMiles: '25' };
  const weekend = { start: '2030-06-14', end: '2030-06-16' };
  const origin = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  let userId: string;
  let venueIds: unknown[];

  async function createVenue(name: string, overrides: Record<string, unknown> = {}) {
    const venue = await venueModel.create({
      name: `Radius test: ${name}`, city, email: 'booking@example.com',
      status: 'active', outreachEligible: true, location, ...overrides,
    });
    venueIds.push(venue._id);
    return venue;
  }

  function candidates(query: Record<string, unknown> = {}) {
    return request(app).get('/outreach/candidates')
      .set({ origin })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`)
      .query({ cities: city, ...query });
  }

  beforeEach(async () => {
    venueIds = [];
    await venueModel.Schema.init();
    const user = await userModel.create({
      name: 'Radius search test', email: 'radius-search-test@example.com', privileges: ['outreach:create'],
    });
    userId = String(user._id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await outreachModel.deleteMany({ venueId: { $in: venueIds } });
    await gigModel.deleteMany({ venueId: { $in: venueIds } });
    await venueModel.deleteMany({ _id: { $in: venueIds } });
    await userModel.deleteMany({ _id: userId });
  });

  it('includes an inside venue and excludes it when the same search moves 100 miles north', async () => {
    const venue = await createVenue('inside');
    const inside = await candidates(radius);
    expect(inside.status).toBe(200);
    expect(inside.body).toEqual([expect.objectContaining({ _id: String(venue._id) })]);

    // 100 miles along a meridian, using the equatorial radius for Mongo's sphere.
    const farLat = 37.27 + (100 / 3963.2) * (180 / Math.PI);
    const outside = await candidates({ ...radius, lat: String(farLat) });
    expect(outside.status).toBe(200);
    expect(outside.body).toEqual([]);
  });

  it('measures the requested radius in miles', async () => {
    const northByMiles = (miles: number) => ({
      type: 'Point', coordinates: [-80.06, 37.27 + (miles / 3963.2) * (180 / Math.PI)],
    });
    const near = await createVenue('20 miles north', { location: northByMiles(20) });
    await createVenue('30 miles north', { location: northByMiles(30) });
    const response = await candidates(radius);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ _id: String(near._id) })]);
  });

  it('omits venues without exact pins only for radius queries', async () => {
    const unlocated = await createVenue('no location', { location: undefined });
    const located = await createVenue('located');
    const filtered = await candidates(radius);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual([expect.objectContaining({ _id: String(located._id) })]);
    const unfiltered = await candidates();
    expect(unfiltered.status).toBe(200);
    expect(unfiltered.body).toHaveLength(2);
    expect(unfiltered.body).toContainEqual(expect.objectContaining({ _id: String(unlocated._id) }));
  });

  it('keeps all eligibility gates, cooldowns and gig spacing when a radius and target weekend are given', async () => {
    const eligible = await createVenue('eligible');
    const future = new Date('2031-01-01');
    await createVenue('unvetted', { outreachEligible: false });
    await createVenue('archived', { status: 'archived' });
    await createVenue('invalid email', { email: 'invalid' });
    await createVenue('no email', { email: '' });
    await createVenue('resume later', { resumeBooking: future });
    await createVenue('booked through', { bookedThrough: future });
    await createVenue('too far', { location: { type: 'Point', coordinates: [-80.06, 39] } });
    await createVenue('unknown location', { location: undefined });
    const defaultSpacing = await createVenue('default gig spacing');
    const customSpacing = await createVenue('custom gig spacing', { gigInterval: 6 });
    await gigModel.create({
      venue: defaultSpacing.name, venueId: defaultSpacing._id, datetime: '2030-06-15', artist: DEFAULT_ARTIST,
    });
    await gigModel.create({
      venue: customSpacing.name, venueId: customSpacing._id, datetime: '2030-09-15', artist: DEFAULT_ARTIST,
    });
    const recent = await createVenue('recent overlapping pitch');
    await outreachModel.create({ venueId: recent._id, status: 'sent', sentAt: new Date(), targetWeekend: weekend });
    const otherWeekend = await createVenue('pitch for another weekend');
    await outreachModel.create({
      venueId: otherWeekend._id, status: 'sent', sentAt: new Date(),
      targetWeekend: { start: '2030-08-16', end: '2030-08-18' },
    });

    const response = await candidates({ ...radius, targetDates: `${weekend.start} to ${weekend.end}` });
    expect(response.status).toBe(200);
    const body = response.body as { candidates: { _id: string }[]; weekendGigs: { venueId: string }[] };
    expect(body.candidates.map((venue) => venue._id).sort()).toEqual([String(eligible._id), String(otherWeekend._id)].sort());
    // The radius limits candidates, while the existing weekend-gig context stays intact.
    expect(body.weekendGigs).toContainEqual(expect.objectContaining({ venueId: String(defaultSpacing._id) }));
  });

  it.each([
    'lat=37.27', 'lat=37.27&lng=-80.06', 'lat=37.27&lng=-80.06&radiusMiles=invalid',
    'lat=91&lng=-80.06&radiusMiles=25', 'lat=37.27&lng=-181&radiusMiles=25',
    'lat=37.27&lng=-80.06&radiusMiles=0', 'lat=37.27&lat=38&lng=-80.06&radiusMiles=25',
  ])('answers 400 with no candidates for invalid HTTP query %s', async (query) => {
    await createVenue('must not leak into an unfiltered result');
    const response = await request(app).get(`/outreach/candidates?${query}`)
      .set({ origin })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: userId })}`);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: expect.any(String) });
  });

  it('answers 500 without candidates if the geospatial query fails', async () => {
    vi.spyOn(venueModel, 'find').mockRejectedValue(new Error('Geo query failed'));
    const response = await candidates(radius);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Geo query failed' });
  });
});

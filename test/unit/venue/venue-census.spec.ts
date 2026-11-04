import express from 'express';
import type { Request, Response as ExpressResponse } from 'express';
import controller from '#src/model/venue/venue-controller.js';
import venueModel from '#src/model/venue/venue-facade.js';
import userModel from '#src/model/user/user-facade.js';
import { findCensusPosition } from '#src/model/venue/census-geocoder.js';
import request from '../../helpers/api.js';

const realFetch = globalThis.fetch.bind(globalThis);
const id = '507f1f77bcf86cd799439011';
const address = { address: '1 Main St', city: 'Salem', usState: 'VA', zipCode: '24153' };
const point = { type: 'Point', coordinates: [-80.06, 37.27] };
const match = { result: { addressMatches: [{ coordinates: { x: -80.06, y: 37.27 } }] } };
const censusFetch = vi.fn<typeof fetch>();
// Mount the real write handlers with stubbed auth/persistence, so all save
// outcomes run through HTTP without a Census request or a database connection.
const writes = controller as unknown as {
  createVenue(req: Request, res: ExpressResponse): Promise<unknown>;
  updateVenue(req: Request, res: ExpressResponse): Promise<unknown>;
};
const app = express();
app.use(express.json());
app.post('/venue', (req, res) => writes.createVenue(req, res));
app.patch('/venue/:id', (req, res) => writes.updateVenue(req, res));

beforeEach(() => {
  censusFetch.mockReset().mockImplementation(async () => Response.json(match));
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => (
    String(url).startsWith('https://geocoding.geo.census.gov/') ? censusFetch(url, init) : realFetch(url, init)
  ));
  vi.spyOn(userModel, 'findById').mockResolvedValue({ privileges: ['venue:create', 'venue:edit'] });
  vi.spyOn(venueModel, 'find').mockResolvedValue([]);
  vi.spyOn(venueModel, 'findById').mockResolvedValue({ _id: id, name: 'Venue', ...address, location: point });
  vi.spyOn(venueModel, 'findOne').mockResolvedValue(null);
  vi.spyOn(venueModel, 'create').mockImplementation(async (body) => (
    { _id: id, ...body } as unknown as Awaited<ReturnType<typeof venueModel.create>>
  ));
  vi.spyOn(venueModel, 'findByIdAndUpdate').mockImplementation(async (_id, body) => ({ _id, ...body }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Census address lookup', () => {
  it('requests the complete address and reads longitude before latitude', async () => {
    expect(await findCensusPosition(address)).toEqual(point);
    const url = new URL(String(censusFetch.mock.calls[0][0]));
    expect(url.pathname).toBe('/geocoder/locations/address');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      street: '1 Main St', city: 'Salem', state: 'VA', zip: '24153', benchmark: 'Public_AR_Current', format: 'json',
    });
  });

  it.each([
    {}, null, { result: null }, { result: { addressMatches: [] } },
    { result: { addressMatches: {} } }, { result: { addressMatches: [null] } },
    ...[{ x: '1', y: 2 }, { x: 1, y: null }, { x: 181, y: 0 }, { x: 0, y: -91 }, { x: null, y: 2 }]
      .map((coordinates) => ({ result: { addressMatches: [{ coordinates }] } })),
  ])('returns no position for an empty or malformed response %j', async (body) => {
    censusFetch.mockResolvedValue(Response.json(body));
    expect(await findCensusPosition(address)).toBeUndefined();
  });

  it.each(['network', 'http', 'json'])('returns no position on %s failure', async (failure) => {
    if (failure === 'network') censusFetch.mockRejectedValue(new Error('unreachable'));
    if (failure === 'http') censusFetch.mockResolvedValue(new Response('', { status: 503 }));
    if (failure === 'json') censusFetch.mockResolvedValue(new Response('invalid JSON'));
    expect(await findCensusPosition(address)).toBeUndefined();
  });

  it.each(['headers', 'body'])('stops waiting after five seconds for %s', async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    censusFetch.mockImplementation(async (_url, init) => {
      signal = init?.signal;
      if (stage === 'headers') return new Promise<Response>(() => {});
      return { ok: true, json: () => new Promise<unknown>(() => {}) } as unknown as Response;
    });
    const result = findCensusPosition(address);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ ...address, country: 'CA' }, { city: 'Salem', zipCode: '24153' }])('skips unsupported or streetless addresses %j', async (body) => {
    expect(await findCensusPosition(body)).toBeUndefined();
    expect(censusFetch).not.toHaveBeenCalled();
  });
});

describe('venue saves with Census', () => {
  it('POST without a location stores a found position and saves', async () => {
    const saved = await request(app).post('/venue').send({ name: 'Venue', ...address });
    expect(saved.status).toBe(201);
    expect(saved.body.location).toEqual(point);
    expect(censusFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['post', 'patch'] as const)('%s with an explicit location skips Census', async (method) => {
    const saved = await request(app)[method](method === 'post' ? '/venue' : `/venue/${id}`)
      .send({ name: 'Venue', ...address, address: '2 Main St', location: point });
    expect(saved.status).toBe(method === 'post' ? 201 : 200);
    expect(saved.body.location).toEqual(point);
    expect(censusFetch).not.toHaveBeenCalled();
  });

  it.each([
    { address: '2 Main St' }, { city: 'Roanoke' }, { usState: 'NC' }, { zipCode: '24154' },
  ])('PATCH uses the merged address when %j changes', async (change) => {
    const saved = await request(app).patch(`/venue/${id}`).send(change);
    expect(saved.status).toBe(200);
    expect(saved.body.location).toEqual(point);
    const merged = { ...address, ...change };
    const params = new URL(String(censusFetch.mock.calls[0][0])).searchParams;
    expect(params.get('street')).toBe(merged.address);
    expect(params.get('city')).toBe(merged.city);
    expect(params.get('state')).toBe(merged.usState);
    expect(params.get('zip')).toBe(merged.zipCode);
  });

  it.each([{ name: 'Renamed' }, { ...address }])('PATCH skips Census for unchanged address %j', async (body) => {
    const saved = await request(app).patch(`/venue/${id}`).send(body);
    expect(saved.status).toBe(200);
    expect(censusFetch).not.toHaveBeenCalled();
    expect(venueModel.findByIdAndUpdate).toHaveBeenCalledWith(id, expect.not.objectContaining({ $unset: expect.anything() }));
  });

  it.each(['post', 'patch'] as const)('%s still saves when Census finds no match', async (method) => {
    censusFetch.mockResolvedValue(Response.json({ result: { addressMatches: [] } }));
    const saved = await request(app)[method](method === 'post' ? '/venue' : `/venue/${id}`)
      .send({ name: 'Venue', ...address, address: '2 Main St' });
    expect(saved.status).toBe(method === 'post' ? 201 : 200);
    expect(saved.body).not.toHaveProperty('location');
    if (method === 'patch') expect(saved.body.$unset).toEqual({ location: 1 });
  });

  it.each(['post', 'patch'] as const)('%s still saves when Census is unreachable', async (method) => {
    censusFetch.mockRejectedValue(new Error('unreachable'));
    const saved = await request(app)[method](method === 'post' ? '/venue' : `/venue/${id}`)
      .send({ name: 'Venue', ...address, address: '2 Main St' });
    expect(saved.status).toBe(method === 'post' ? 201 : 200);
    expect(saved.body).not.toHaveProperty('location');
    if (method === 'patch') expect(saved.body.$unset).toEqual({ location: 1 });
  });

  it.each(['post', 'patch'] as const)('%s saves without a position after the five-second deadline', async (method) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const started = Promise.withResolvers<void>();
    censusFetch.mockImplementation(() => {
      started.resolve();
      return new Promise<Response>(() => {});
    });
    const saved = Promise.resolve(request(app)[method](method === 'post' ? '/venue' : `/venue/${id}`)
      .send({ name: 'Venue', ...address, address: '2 Main St' }));
    await started.promise;
    await vi.advanceTimersByTimeAsync(5000);
    const result = await saved;
    expect(result.status).toBe(method === 'post' ? 201 : 200);
    expect(result.body).not.toHaveProperty('location');
    if (method === 'patch') expect(result.body.$unset).toEqual({ location: 1 });
  });

  it('clears an old position when the venue moves outside the US without calling Census', async () => {
    const saved = await request(app).patch(`/venue/${id}`).send({ country: 'CA', city: 'Toronto' });
    expect(saved.status).toBe(200);
    expect(saved.body.$unset).toEqual({ location: 1 });
    expect(censusFetch).not.toHaveBeenCalled();
  });

  it('skips Census on a non-US create', async () => {
    const saved = await request(app).post('/venue').send({ name: 'Venue', ...address, country: 'CA' });
    expect(saved.status).toBe(201);
    expect(saved.body).not.toHaveProperty('location');
    expect(censusFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('POST dedup updates an existing venue, changed address = %s', async (changed) => {
    vi.mocked(venueModel.find).mockResolvedValue([{ _id: id, name: 'Venue', ...address, location: point }]);
    const saved = await request(app).post('/venue').send({ name: 'Venue', ...address, zipCode: changed ? '24154' : '24153' });
    expect(saved.status).toBe(200);
    expect(censusFetch).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(venueModel.create).not.toHaveBeenCalled();
  });

  it('clears the pin without blocking a save if the stored address lookup fails', async () => {
    vi.mocked(venueModel.findById).mockRejectedValue(new Error('read failed'));
    const saved = await request(app).patch(`/venue/${id}`).send({ city: 'Roanoke' });
    expect(saved.status).toBe(200);
    expect(saved.body.$unset).toEqual({ location: 1 });
    expect(censusFetch).not.toHaveBeenCalled();
  });
});

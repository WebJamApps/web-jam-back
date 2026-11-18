import { vi } from 'vitest';
import {
  hasStreetAddress,
  searchVenueAddress,
  verifyVenuePlace,
} from '#src/model/inquiry/lookup-venue.js';

describe('hasStreetAddress', () => {
  it('requires both street_number and route components', () => {
    expect(hasStreetAddress([
      { longText: '123', types: ['street_number'] },
      { longText: 'Main St', types: ['route'] },
    ])).toBe(true);
    expect(hasStreetAddress([{ longText: 'Salem', types: ['locality'] }])).toBe(false);
    expect(hasStreetAddress([{ longText: 'Main St', types: ['route'] }])).toBe(false);
    expect(hasStreetAddress([{ longText: '123', types: ['street_number'] }])).toBe(false);
  });
});

describe('verifyVenuePlace', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it('requests only the address fields and retains components for the address check', async () => {
    const addressComponents = [{ longText: '123', types: ['street_number'] }];
    fetchMock.mockResolvedValue(Response.json({ formattedAddress: ' 123 Main St ', addressComponents }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(await verifyVenuePlace('place/with ?characters', 'artist-test-key')).toEqual({
      status: 'resolved', formattedAddress: '123 Main St', addressComponents,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://places.googleapis.com/v1/places/place%2Fwith%20%3Fcharacters', {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': 'artist-test-key',
        'X-Goog-FieldMask': 'formattedAddress,addressComponents',
      },
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(5000);
    timeout.mockRestore();
  });

  it('resolves HTTP 200 with street_number and route components', async () => {
    const addressComponents = [
      { longText: '123', types: ['street_number'] },
      { longText: 'Main St', types: ['route'] },
    ];
    fetchMock.mockResolvedValue(Response.json({
      formattedAddress: '123 Main St, Salem, VA 24153, USA',
      addressComponents,
    }));

    expect(await verifyVenuePlace('valid-place-id', 'artist-test-key')).toEqual({
      status: 'resolved',
      formattedAddress: '123 Main St, Salem, VA 24153, USA',
      addressComponents,
    });
  });

  it('resolves a city-level place; street-level enforcement belongs to hasStreetAddress', async () => {
    fetchMock.mockResolvedValue(Response.json({ formattedAddress: 'Salem, VA' }));
    expect(await verifyVenuePlace('city', 'artist-test-key')).toEqual({
      status: 'resolved', formattedAddress: 'Salem, VA', addressComponents: [],
    });
  });

  it.each([undefined, '', '   '])('skips Google without a usable key (%s)', async (key) => {
    expect(await verifyVenuePlace('place-id', key)).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([403, 429, 500])('treats HTTP %s as unavailable', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['no details field', { error: { code: 400, message: 'The provided Place ID: abc is not valid.', status: 'INVALID_ARGUMENT' } }],
    ['empty details array', { error: { code: 400, message: 'The provided Place ID: abc is not valid.', status: 'INVALID_ARGUMENT', details: [] } }],
    [
      'LocalizedMessage-only detail',
      {
        error: {
          code: 400,
          message: 'The provided Place ID: abc is not valid.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'en-US', message: 'Invalid place ID' }],
        },
      },
    ],
  ])('treats HTTP 400 with %s as not-found', async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status: 400 }));
    expect(await verifyVenuePlace('abc', 'artist-test-key')).toEqual({ status: 'not-found' });
  });

  it.each([
    [
      'reason API_KEY_INVALID',
      {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
        },
      },
    ],
    [
      'reason API_KEY_EXPIRED',
      {
        error: {
          code: 400,
          message: 'API key expired. Please renew the API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_EXPIRED' }],
        },
      },
    ],
    ['null JSON payload', null],
    ['non-error JSON object', {}],
  ])('treats HTTP 400 with %s as unavailable', async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json(body, { status: 400 }));
    expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it('treats HTTP 400 with a non-JSON body as unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Request</html>', { status: 400 }));
    expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it.each([null, {}, { formattedAddress: '' }, { formattedAddress: '  ' }, { formattedAddress: 123 }])(
    'treats an unresolved response (%j) as not-found', async (data) => {
      fetchMock.mockResolvedValue(Response.json(data));
      expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'not-found' });
    },
  );

  it('treats invalid JSON as unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('invalid JSON'));
    expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it.each([new Error('network error'), new DOMException('timed out', 'TimeoutError')])(
    'treats a failed request (%s) as unavailable', async (error) => {
      fetchMock.mockRejectedValue(error);
      expect(await verifyVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
    },
  );

  it('treats a 404 as not-found and a blank place id as not-found without calling Google', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await verifyVenuePlace('bad-place', 'artist-test-key')).toEqual({ status: 'not-found' });
    fetchMock.mockClear();
    expect(await verifyVenuePlace('   ', 'artist-test-key')).toEqual({ status: 'not-found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('searchVenueAddress', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it('queries Google Places searchText and returns the first resolved place', async () => {
    const addressComponents = [
      { longText: '106', types: ['street_number'] },
      { longText: 'Eagle Dr', types: ['route'] },
    ];
    fetchMock.mockResolvedValue(Response.json({
      places: [
        { formattedAddress: ' 106 Eagle Dr, Salem, VA 24153 ', addressComponents },
        { formattedAddress: '999 Other Rd, Salem, VA', addressComponents: [] },
      ],
    }));

    expect(await searchVenueAddress(' 106 Eagle Dr, Salem VA ', 'artist-test-key')).toEqual({
      status: 'resolved',
      formattedAddress: '106 Eagle Dr, Salem, VA 24153',
      addressComponents,
    });
    expect(fetchMock).toHaveBeenCalledWith('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': 'artist-test-key',
        'X-Goog-FieldMask': 'places.formattedAddress,places.addressComponents',
      },
      body: JSON.stringify({ textQuery: '106 Eagle Dr, Salem VA' }),
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    Response.json({}),
    Response.json({ places: [] }),
    new Response(null, { status: 404 }),
  ])('treats empty search results or 404 as not-found', async (resp) => {
    fetchMock.mockResolvedValue(resp);
    expect(await searchVenueAddress('Nowhere', 'artist-test-key')).toEqual({ status: 'not-found' });
  });

  it('treats missing key, API errors, timeouts, and invalid JSON as unavailable', async () => {
    expect(await searchVenueAddress('106 Eagle Dr', undefined)).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await searchVenueAddress('106 Eagle Dr', 'artist-test-key')).toEqual({ status: 'unavailable' });

    fetchMock.mockResolvedValueOnce(new Response('bad-json'));
    expect(await searchVenueAddress('106 Eagle Dr', 'artist-test-key')).toEqual({ status: 'unavailable' });

    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    expect(await searchVenueAddress('106 Eagle Dr', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });
});

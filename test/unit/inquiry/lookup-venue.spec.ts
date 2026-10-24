import { vi } from 'vitest';
import { lookupVenuePlace } from '#src/model/inquiry/lookup-venue.js';

describe('lookupVenuePlace', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it('requests only the address fields and retains components for the later address check', async () => {
    const addressComponents = [{ longText: '123', types: ['street_number'] }];
    fetchMock.mockResolvedValue(Response.json({ formattedAddress: ' 123 Main St ', addressComponents }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(await lookupVenuePlace('place/with ?characters', 'artist-test-key')).toEqual({
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

  it('resolves an address without enforcing street components yet', async () => {
    fetchMock.mockResolvedValue(Response.json({ formattedAddress: 'Salem, VA' }));
    expect(await lookupVenuePlace('city', 'artist-test-key')).toEqual({
      status: 'resolved', formattedAddress: 'Salem, VA', addressComponents: [],
    });
  });

  it.each([undefined, '', '   '])('skips Google without a usable key (%s)', async (key) => {
    expect(await lookupVenuePlace('place-id', key)).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([403, 404, 429, 500])('treats HTTP %s as unavailable', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await lookupVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it.each([null, {}, { formattedAddress: '' }, { formattedAddress: '  ' }, { formattedAddress: 123 }])(
    'treats an unresolved response (%j) as unavailable', async (data) => {
      fetchMock.mockResolvedValue(Response.json(data));
      expect(await lookupVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
    },
  );

  it('treats invalid JSON as unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('invalid JSON'));
    expect(await lookupVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
  });

  it.each([new Error('network error'), new DOMException('timed out', 'TimeoutError')])(
    'treats a failed request (%s) as unavailable', async (error) => {
      fetchMock.mockRejectedValue(error);
      expect(await lookupVenuePlace('place-id', 'artist-test-key')).toEqual({ status: 'unavailable' });
    },
  );
});

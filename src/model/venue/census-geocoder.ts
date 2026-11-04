interface VenueAddress {
  address?: unknown;
  city?: unknown;
  usState?: unknown;
  zipCode?: unknown;
  country?: unknown;
}

interface Point { type: 'Point'; coordinates: [number, number] }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readPoint(payload: unknown): Point | undefined {
  const matches = record(record(payload).result).addressMatches;
  if (!Array.isArray(matches)) return undefined;
  const { x, y } = record(record(matches[0]).coordinates);
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 180 ||
      typeof y !== 'number' || !Number.isFinite(y) || Math.abs(y) > 90) return undefined;
  return { type: 'Point', coordinates: [x, y] };
}

// https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
// A failed lookup is optional data, never a failed venue save. The deadline
// covers both receiving the headers and consuming the response body.
export async function findCensusPosition(venue: VenueAddress): Promise<Point | undefined> {
  if ((text(venue.country) || 'US').toUpperCase() !== 'US' || !text(venue.address)) return undefined;
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/address');
  url.search = new URLSearchParams({
    street: text(venue.address), city: text(venue.city), state: text(venue.usState), zip: text(venue.zipCode),
    benchmark: 'Public_AR_Current', format: 'json',
  }).toString();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(undefined); }, 5000);
  });
  try {
    const lookup = async (): Promise<Point | undefined> => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return undefined;
      return readPoint(await response.json());
    };
    return await Promise.race([lookup(), deadline]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

const ADDRESS_FIELDS = ['address', 'city', 'usState', 'zipCode', 'country'] as const;

export function hasVenueAddressUpdate(body: VenueAddress): boolean {
  return ADDRESS_FIELDS.some((key) => Object.hasOwn(body, key));
}

// Returns only the persistence change for location. $unset is required here:
// Mongoose drops undefined update values and would otherwise keep the old pin.
export async function censusLocationUpdate(
  body: VenueAddress & { location?: unknown },
  existing: (VenueAddress & { location?: unknown }) | null,
): Promise<Record<string, unknown>> {
  if (body.location !== undefined) return {};
  if (existing && !ADDRESS_FIELDS.some((key) => Object.hasOwn(body, key) && text(body[key]) !== text(existing[key]))) return {};
  const location = await findCensusPosition({ ...existing, ...body });
  if (location) return { location };
  return existing ? { $unset: { location: 1 } } : {};
}

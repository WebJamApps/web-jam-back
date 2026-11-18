export interface VenueAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export type VenuePlaceLookup =
  | { status: 'resolved'; formattedAddress: string; addressComponents: VenueAddressComponent[] }
  | { status: 'unavailable' };

export type VenueVerificationResult =
  | VenuePlaceLookup
  | { status: 'not-found' };

interface RawPlacePayload {
  formattedAddress?: unknown;
  addressComponents?: VenueAddressComponent[];
}

export function hasStreetAddress(components: VenueAddressComponent[]): boolean {
  const hasNumber = components.some((c) => Array.isArray(c.types) && c.types.includes('street_number'));
  const hasRoute = components.some((c) => Array.isArray(c.types) && c.types.includes('route'));
  return hasNumber && hasRoute;
}

function toResolvedPlace(raw: RawPlacePayload | null | undefined): VenueVerificationResult {
  const address = typeof raw?.formattedAddress === 'string' ? raw.formattedAddress.trim() : '';
  if (!address) return { status: 'not-found' };
  return {
    status: 'resolved',
    formattedAddress: address,
    addressComponents: Array.isArray(raw?.addressComponents) ? raw.addressComponents : [],
  };
}

// Google Places (New) returns HTTP 400 INVALID_ARGUMENT both for a place ID that
// does not exist (no `reason` in `error.details`) and for key/config failures
// (e.g. `reason: "API_KEY_INVALID"`). Only an error carrying no reason means the
// place ID itself is invalid; anything with a reason or non-error shape fails
// open to `unavailable` so a broken key never drops a real booking.
function isGoogleBadPlaceError(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const err = (payload as { error?: unknown }).error;
  if (!err || typeof err !== 'object') return false;
  const details = (err as { details?: unknown }).details;
  if (!Array.isArray(details)) return true;
  return !details.some(
    (d) => Boolean(d)
      && typeof d === 'object'
      && typeof (d as { reason?: unknown }).reason === 'string'
      && (d as { reason: string }).reason.trim().length > 0,
  );
}

export async function verifyVenuePlace(placeId: string, apiKey?: string): Promise<VenueVerificationResult> {
  if (!apiKey?.trim()) return { status: 'unavailable' };
  const trimmedId = placeId.trim();
  if (!trimmedId) return { status: 'not-found' };

  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(trimmedId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return { status: 'not-found' };
    if (response.status === 400) {
      const errorPayload: unknown = await response.json();
      return isGoogleBadPlaceError(errorPayload) ? { status: 'not-found' } : { status: 'unavailable' };
    }
    if (!response.ok) return { status: 'unavailable' };

    const data = await response.json() as RawPlacePayload | null;
    return toResolvedPlace(data);
  } catch {
    // Includes network errors, timeouts and malformed JSON. Do not log Google's
    // response or request headers, which may contain the artist's server key.
    return { status: 'unavailable' };
  }
}

export async function searchVenueAddress(addressQuery: string, apiKey?: string): Promise<VenueVerificationResult> {
  if (!apiKey?.trim()) return { status: 'unavailable' };
  const trimmedQuery = addressQuery.trim();
  if (!trimmedQuery) return { status: 'not-found' };

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.formattedAddress,places.addressComponents',
      },
      body: JSON.stringify({ textQuery: trimmedQuery }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return { status: 'not-found' };
    if (!response.ok) return { status: 'unavailable' };

    const data = await response.json() as { places?: RawPlacePayload[] } | null;
    if (!data || typeof data !== 'object') return { status: 'unavailable' };
    const first = Array.isArray(data.places) ? data.places[0] : undefined;
    return toResolvedPlace(first);
  } catch {
    // Do not log response or request headers containing the artist's server key.
    return { status: 'unavailable' };
  }
}

export interface VenueAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export type VenuePlaceLookup =
  | { status: 'resolved'; formattedAddress: string; addressComponents: VenueAddressComponent[] }
  | { status: 'unavailable' };

// Address components are retained for the later booking-address check. This
// lookup only enriches email content; unavailable lookups must still deliver.
export async function lookupVenuePlace(placeId: string, apiKey?: string): Promise<VenuePlaceLookup> {
  if (!apiKey?.trim()) return { status: 'unavailable' };

  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: 'unavailable' };

    const data = await response.json() as { formattedAddress?: unknown; addressComponents?: VenueAddressComponent[] } | null;
    const address = typeof data?.formattedAddress === 'string' ? data.formattedAddress.trim() : '';
    if (!address) return { status: 'unavailable' };
    return {
      status: 'resolved',
      formattedAddress: address,
      addressComponents: Array.isArray(data?.addressComponents) ? data.addressComponents : [],
    };
  } catch {
    // Includes network errors, timeouts and malformed JSON. Do not log Google's
    // response or request headers, which may contain the artist's server key.
    return { status: 'unavailable' };
  }
}

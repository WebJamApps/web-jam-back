import MapListing, { type MapListingRecord } from './map-listing-schema.js';
import { MAP_LISTING_LOCK_ID } from './map-listing-refresh.js';

export const LISTINGS_SEARCH_LIMIT = 5;
export const MIN_LISTINGS_QUERY_LENGTH = 2;

export interface VenueListingSearchItem {
  listingId: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  website: string;
  lat: number;
  lng: number;
}

export type VenueListingsSearchOutcome =
  | { status: 'ok'; items: VenueListingSearchItem[] }
  | { status: 'not-loaded' }
  | { status: 'unavailable' };

const SEARCH_PROJECTION = {
  _id: 0,
  listingId: 1,
  name: 1,
  street: 1,
  city: 1,
  state: 1,
  zipCode: 1,
  website: 1,
  location: 1,
} as const;

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toSearchItem(doc: MapListingRecord): VenueListingSearchItem {
  const coords = Array.isArray(doc.location?.coordinates) ? doc.location.coordinates : [];
  const lng = typeof coords[0] === 'number' ? coords[0] : 0;
  const lat = typeof coords[1] === 'number' ? coords[1] : 0;
  return {
    listingId: doc.listingId,
    name: doc.name,
    street: doc.street,
    city: doc.city || '',
    state: doc.state || '',
    zipCode: doc.zipCode || '',
    website: doc.website || '',
    lat,
    lng,
  };
}

function wordBoundaryHit(haystack: string, word: string): boolean {
  const idx = haystack.indexOf(word);
  if (idx === -1) return false;
  return idx === 0 || !/[a-z0-9]/.test(haystack.charAt(idx - 1));
}

function compareByPrefixMatch(a: MapListingRecord, b: MapListingRecord, queryLower: string): number {
  const aExact = a.name.toLowerCase() === queryLower ? 0 : 1;
  const bExact = b.name.toLowerCase() === queryLower ? 0 : 1;
  if (aExact !== bExact) return aExact - bExact;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name) || a.listingId.localeCompare(b.listingId);
}

function wordMatchScore(doc: MapListingRecord, wordsLower: string[], queryLower: string): number {
  const nameLower = doc.name.toLowerCase();
  const cityLower = (doc.city || '').toLowerCase();
  let score = 0;

  if (nameLower.includes(queryLower)) score += 100;
  for (const w of wordsLower) {
    if (nameLower.includes(w)) {
      score += 10;
      if (wordBoundaryHit(nameLower, w)) score += 5;
    } else if (cityLower.includes(w)) {
      score += 3;
      if (wordBoundaryHit(cityLower, w)) score += 2;
    }
  }
  return score;
}

function compareByWordScore(
  a: MapListingRecord,
  b: MapListingRecord,
  wordsLower: string[],
  queryLower: string,
): number {
  const scoreDiff = wordMatchScore(b, wordsLower, queryLower) - wordMatchScore(a, wordsLower, queryLower);
  if (scoreDiff !== 0) return scoreDiff;
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  return a.name.localeCompare(b.name) || a.listingId.localeCompare(b.listingId);
}

export async function searchVenueListings(rawQuery: string): Promise<VenueListingsSearchOutcome> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < MIN_LISTINGS_QUERY_LENGTH) {
    return { status: 'ok', items: [] };
  }

  try {
    const sample = await MapListing.findOne({ listingId: { $ne: MAP_LISTING_LOCK_ID } }, { _id: 1 })
      .lean()
      .exec();
    if (!sample) {
      return { status: 'not-loaded' };
    }

    const escapedQuery = escapeRegexLiteral(trimmed);
    const prefixDocs = await MapListing.find(
      {
        listingId: { $ne: MAP_LISTING_LOCK_ID },
        name: { $regex: `^${escapedQuery}`, $options: 'i' },
      },
      SEARCH_PROJECTION,
    )
      .limit(50)
      .lean()
      .exec() as unknown as MapListingRecord[];

    const queryLower = trimmed.toLowerCase();
    const sortedPrefix = [...prefixDocs].sort((a, b) => compareByPrefixMatch(a, b, queryLower));

    const results: VenueListingSearchItem[] = [];
    const seen = new Set<string>();
    for (const doc of sortedPrefix) {
      if (!seen.has(doc.listingId)) {
        seen.add(doc.listingId);
        results.push(toSearchItem(doc));
        if (results.length >= LISTINGS_SEARCH_LIMIT) {
          return { status: 'ok', items: results };
        }
      }
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    const wordClauses = words.map((word) => {
      const pattern = escapeRegexLiteral(word);
      return {
        $or: [
          { name: { $regex: pattern, $options: 'i' } },
          { city: { $regex: pattern, $options: 'i' } },
        ],
      };
    });

    const wordDocs = await MapListing.find(
      {
        listingId: { $ne: MAP_LISTING_LOCK_ID },
        $and: wordClauses,
      },
      SEARCH_PROJECTION,
    )
      .limit(100)
      .lean()
      .exec() as unknown as MapListingRecord[];

    const wordsLower = words.map((w) => w.toLowerCase());
    const sortedWords = [...wordDocs].sort((a, b) => compareByWordScore(a, b, wordsLower, queryLower));

    for (const doc of sortedWords) {
      if (!seen.has(doc.listingId)) {
        seen.add(doc.listingId);
        results.push(toSearchItem(doc));
        if (results.length >= LISTINGS_SEARCH_LIMIT) {
          break;
        }
      }
    }

    return { status: 'ok', items: results };
  } catch {
    return { status: 'unavailable' };
  }
}

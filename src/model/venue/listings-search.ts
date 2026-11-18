import type { PipelineStage } from 'mongoose';
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

function buildPrefixPipeline(escapedQuery: string): PipelineStage[] {
  return [
    {
      $match: {
        listingId: { $ne: MAP_LISTING_LOCK_ID },
        name: { $regex: `^${escapedQuery}`, $options: 'i' },
      },
    },
    {
      $addFields: {
        _isExact: {
          $cond: [
            { $regexMatch: { input: { $ifNull: ['$name', ''] }, regex: `^${escapedQuery}$`, options: 'i' } },
            0,
            1,
          ],
        },
        _nameLen: { $strLenCP: { $ifNull: ['$name', ''] } },
        _nameLower: { $toLower: { $ifNull: ['$name', ''] } },
      },
    },
    {
      $sort: {
        _isExact: 1,
        _nameLen: 1,
        _nameLower: 1,
        name: 1,
        listingId: 1,
      },
    },
    { $limit: LISTINGS_SEARCH_LIMIT },
    { $project: SEARCH_PROJECTION },
  ];
}

function buildFieldWordScore(
  fieldExpr: string | Record<string, unknown>,
  pattern: string,
  boundaryRegex: string,
  basePoints: number,
  boundaryPoints: number,
  fallbackExpr: number | Record<string, unknown>,
): Record<string, unknown> {
  return {
    $cond: [
      { $regexMatch: { input: fieldExpr, regex: pattern, options: 'i' } },
      {
        $cond: [
          { $regexMatch: { input: fieldExpr, regex: boundaryRegex, options: 'i' } },
          basePoints + boundaryPoints,
          basePoints,
        ],
      },
      fallbackExpr,
    ],
  };
}

function buildWordPipeline(
  escapedQuery: string,
  words: string[],
  seenIds: ReadonlySet<string>,
  limit: number,
): PipelineStage[] {
  const wordClauses = words.map((word) => {
    const pattern = escapeRegexLiteral(word);
    return {
      $or: [
        { name: { $regex: pattern, $options: 'i' } },
        { city: { $regex: pattern, $options: 'i' } },
      ],
    };
  });

  const nameField = { $ifNull: ['$name', ''] };
  const cityField = { $ifNull: ['$city', ''] };

  const wordScoreTerms: Record<string, unknown>[] = [
    {
      $cond: [
        { $regexMatch: { input: nameField, regex: escapedQuery, options: 'i' } },
        100,
        0,
      ],
    },
    ...words.map((word) => {
      const pattern = escapeRegexLiteral(word);
      const boundaryRegex = `(?:^|[^a-z0-9])${pattern}`;
      const cityScore = buildFieldWordScore(cityField, pattern, boundaryRegex, 3, 2, 0);
      return buildFieldWordScore(nameField, pattern, boundaryRegex, 10, 5, cityScore);
    }),
  ];

  return [
    {
      $match: {
        listingId: { $nin: [MAP_LISTING_LOCK_ID, ...seenIds] },
        $and: wordClauses,
      },
    },
    {
      $addFields: {
        _score: { $add: wordScoreTerms },
        _nameLen: { $strLenCP: nameField },
        _nameLower: { $toLower: nameField },
      },
    },
    {
      $sort: {
        _score: -1,
        _nameLen: 1,
        _nameLower: 1,
        name: 1,
        listingId: 1,
      },
    },
    { $limit: limit },
    { $project: SEARCH_PROJECTION },
  ];
}

function appendUniqueItems(
  results: VenueListingSearchItem[],
  seen: Set<string>,
  docs: MapListingRecord[],
): void {
  for (const doc of docs) {
    if (results.length >= LISTINGS_SEARCH_LIMIT) return;
    if (seen.has(doc.listingId)) continue;
    seen.add(doc.listingId);
    results.push(toSearchItem(doc));
  }
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
    const prefixDocs = await MapListing.aggregate<MapListingRecord>(buildPrefixPipeline(escapedQuery)).exec();

    const results: VenueListingSearchItem[] = [];
    const seen = new Set<string>();
    appendUniqueItems(results, seen, prefixDocs);
    if (results.length >= LISTINGS_SEARCH_LIMIT) {
      return { status: 'ok', items: results };
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    const remaining = LISTINGS_SEARCH_LIMIT - results.length;
    const wordDocs = await MapListing.aggregate<MapListingRecord>(
      buildWordPipeline(escapedQuery, words, seen, remaining),
    ).exec();

    appendUniqueItems(results, seen, wordDocs);

    return { status: 'ok', items: results };
  } catch {
    return { status: 'unavailable' };
  }
}

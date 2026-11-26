import type { PipelineStage } from 'mongoose';
import MapListing, {
  DISCOVER_LISTING_KINDS,
  type DiscoverListingKind,
  type MapListingPoint,
} from './map-listing-schema.js';
import {
  MAP_LISTING_LOCK_ID,
  MAP_LISTING_MAX_RADIUS_MILES,
} from './map-listing-refresh.js';
import MapListingRejection from './map-listing-rejection-schema.js';
import venueModel from './venue-facade.js';
import VenueMiningSweep from '../venue-mining-sweep/venue-mining-sweep-schema.js';

export const DEFAULT_DISCOVER_RADIUS_MILES = 25;
export const MIN_DISCOVER_RADIUS_MILES = 5;
export const MAX_DISCOVER_RADIUS_MILES = 100;
export const METERS_PER_MILE = 1609.344;

// Authoritative copies of NON_MUSIC_ENTITY_KEYWORDS and
// LARGE_HALL_OR_THEATER_KEYWORDS from web-jam-tools/src/venue-mining/sweep.ts
// (web-jam-back is a Node repo and cannot import Deno modules directly).
export const NON_MUSIC_ENTITY_KEYWORDS = [
  'sewing',
  'library',
  'museum',
  'gallery',
  'bookshop',
  'book store',
  'church',
  'synagogue',
  'temple',
  'chapel',
  'ministry',
  'montessori',
  'school',
  'academy',
  'elementary',
  'high school',
  'park',
  'playground',
  'field',
  'loop park',
  'discovery museum',
  'auditorium',
  'aging',
  'senior center',
  'nursing home',
  'music library',
  'recycling center',
  'waste',
  'solid waste',
  'litter cleanup',
  'tennis',
  'pickleball',
  'botanical garden',
] as const;

export const LARGE_HALL_OR_THEATER_KEYWORDS = [
  'theater',
  'theatre',
  'pavilion',
  'amphitheater',
  'amphitheatre',
  'coliseum',
  'arena',
  'stadium',
  'civic center',
  'performing arts center',
  'symphony hall',
  'opera house',
] as const;

export interface DiscoverQueryParams {
  lat: number;
  lng: number;
  radiusMiles: number;
  showRejected: boolean;
}

export type ParseDiscoverQueryResult =
  | { ok: true; params: DiscoverQueryParams }
  | { ok: false; message: string };

export interface DiscoverListingRow {
  listingId: string;
  name: string;
  kind: DiscoverListingKind;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  website: string;
  lat: number;
  lng: number;
  distanceMiles: number;
  rejected: boolean;
}

export type DiscoverListingsOutcome =
  | {
    status: 'ok';
    rows: DiscoverListingRow[];
    lastDownloadedAt: string;
    copyRadiusMiles: number;
  }
  | { status: 'not-loaded' }
  | { status: 'unavailable' };

export interface RejectListingResult {
  listingId: string;
  name: string;
  rejectedBy: string;
  rejectedAt: Date;
}

export type RejectDiscoverListingOutcome =
  | { status: 'created' | 'updated'; rejection: RejectListingResult }
  | { status: 'not-loaded' }
  | { status: 'not-found' }
  | { status: 'unavailable' };

export type UndoRejectDiscoverListingOutcome =
  | { status: 'deleted'; listingId: string }
  | { status: 'not-loaded' }
  | { status: 'not-found' }
  | { status: 'unavailable' };

interface GeoAggListingDoc {
  listingId: string;
  name: string;
  kind: DiscoverListingKind;
  street: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  website?: string;
  location?: MapListingPoint;
  distanceMeters: number;
}

interface VenueNameCity {
  name?: unknown;
  city?: unknown;
}

interface RejectionIdDoc {
  listingId?: unknown;
}

interface SweepKeywordsDoc {
  excludeKeywords?: unknown;
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCity(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isExcludedByKeywords(
  name: string,
  extraKeywords: readonly string[] = [],
): boolean {
  const norm = normalizeMatchText(name);
  if (!norm) return false;
  const padded = ` ${norm} `;
  const allKeywords = [
    ...LARGE_HALL_OR_THEATER_KEYWORDS,
    ...NON_MUSIC_ENTITY_KEYWORDS,
    ...extraKeywords,
  ];
  return allKeywords.some((kw) => {
    if (typeof kw !== 'string') return false;
    const normKw = normalizeMatchText(kw);
    return normKw.length > 0 && padded.includes(` ${normKw} `);
  });
}

export function isDuplicateOfExistingVenue(
  listingName: string,
  listingCity: string | undefined,
  venues: readonly VenueNameCity[],
): boolean {
  const normListingName = normalizeMatchText(listingName);
  const normListingCity = normalizeCity(listingCity);
  if (!normListingName || !normListingCity) return false;

  return venues.some((venue) => {
    if (typeof venue.name !== 'string') return false;
    if (normalizeCity(venue.city) !== normListingCity) return false;
    const normVenueName = normalizeMatchText(venue.name);
    if (!normVenueName) return false;
    if (normVenueName === normListingName) return true;
    return (
      normVenueName.length > 5
      && normListingName.length > 5
      && (normVenueName.includes(normListingName) || normListingName.includes(normVenueName))
    );
  });
}

function parseFiniteQueryNumber(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

export function parseDiscoverQuery(query: Record<string, unknown>): ParseDiscoverQueryResult {
  const lat = parseFiniteQueryNumber(query.lat);
  if (lat === null || Math.abs(lat) > 90) {
    return { ok: false, message: 'lat must be a finite number between -90 and 90' };
  }

  const lng = parseFiniteQueryNumber(query.lng);
  if (lng === null || Math.abs(lng) > 180) {
    return { ok: false, message: 'lng must be a finite number between -180 and 180' };
  }

  let radiusMiles = DEFAULT_DISCOVER_RADIUS_MILES;
  const rawRadius = query.radiusMiles;
  const hasRadiusParam = rawRadius !== undefined && (typeof rawRadius !== 'string' || rawRadius.trim().length > 0);
  if (hasRadiusParam) {
    const parsedRadius = parseFiniteQueryNumber(rawRadius);
    if (
      parsedRadius === null
      || parsedRadius < MIN_DISCOVER_RADIUS_MILES
      || parsedRadius > MAX_DISCOVER_RADIUS_MILES
    ) {
      return {
        ok: false,
        message: `radiusMiles must be between ${MIN_DISCOVER_RADIUS_MILES} and ${MAX_DISCOVER_RADIUS_MILES}`,
      };
    }
    radiusMiles = parsedRadius;
  }

  let showRejected = false;
  const rawShowRejected = query.showRejected;
  if (rawShowRejected !== undefined) {
    if (typeof rawShowRejected !== 'string') {
      return { ok: false, message: 'showRejected must be true or false' };
    }
    const normalizedFlag = rawShowRejected.trim().toLowerCase();
    if (normalizedFlag === 'true') {
      showRejected = true;
    } else if (normalizedFlag !== '' && normalizedFlag !== 'false') {
      return { ok: false, message: 'showRejected must be true or false' };
    }
  }

  return {
    ok: true,
    params: {
      lat,
      lng,
      radiusMiles,
      showRejected,
    },
  };
}

function toValidDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

async function getListingsCopyStatus(): Promise<
  { loaded: true; lastDownloadedAt: Date } | { loaded: false }
> {
  const [sample, lockDoc] = await Promise.all([
    MapListing.findOne({ listingId: { $ne: MAP_LISTING_LOCK_ID } }, { _id: 1 })
      .lean()
      .exec(),
    MapListing.findOne({ listingId: MAP_LISTING_LOCK_ID }, { lastCommittedAt: 1 })
      .lean()
      .exec(),
  ]);
  if (!sample) return { loaded: false };

  const committed = toValidDate((lockDoc as { lastCommittedAt?: unknown } | null)?.lastCommittedAt);
  if (committed) {
    return {
      loaded: true,
      lastDownloadedAt: committed,
    };
  }

  const fallbackDoc = await MapListing.findOne(
    { listingId: { $ne: MAP_LISTING_LOCK_ID } },
    { downloadedAt: 1 },
  )
    .sort({ downloadedAt: -1 })
    .lean()
    .exec();
  const sampled = toValidDate((fallbackDoc as { downloadedAt?: unknown } | null)?.downloadedAt);
  return {
    loaded: true,
    lastDownloadedAt: sampled ?? new Date(0),
  };
}

function buildDiscoverGeoPipeline(params: DiscoverQueryParams): PipelineStage[] {
  return [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [params.lng, params.lat] },
        distanceField: 'distanceMeters',
        maxDistance: params.radiusMiles * METERS_PER_MILE,
        spherical: true,
        query: {
          listingId: { $ne: MAP_LISTING_LOCK_ID },
          kind: { $in: [...DISCOVER_LISTING_KINDS] },
        },
      },
    },
    {
      $sort: {
        distanceMeters: 1,
        name: 1,
        listingId: 1,
      },
    },
    {
      $project: {
        _id: 0,
        listingId: 1,
        name: 1,
        kind: 1,
        street: 1,
        city: 1,
        state: 1,
        zipCode: 1,
        phone: 1,
        website: 1,
        location: 1,
        distanceMeters: 1,
      },
    },
  ];
}

function toDiscoverRow(doc: GeoAggListingDoc, rejected: boolean): DiscoverListingRow {
  const coords = Array.isArray(doc.location?.coordinates) ? doc.location.coordinates : [];
  const lng = typeof coords[0] === 'number' ? coords[0] : 0;
  const lat = typeof coords[1] === 'number' ? coords[1] : 0;
  return {
    listingId: doc.listingId,
    name: doc.name,
    kind: doc.kind,
    street: doc.street,
    city: doc.city || '',
    state: doc.state || '',
    zipCode: doc.zipCode || '',
    phone: doc.phone || '',
    website: doc.website || '',
    lat,
    lng,
    distanceMiles: Math.round((doc.distanceMeters / METERS_PER_MILE) * 100) / 100,
    rejected,
  };
}

export async function discoverVenueListings(
  params: DiscoverQueryParams,
): Promise<DiscoverListingsOutcome> {
  try {
    const copyStatus = await getListingsCopyStatus();
    if (!copyStatus.loaded) {
      return { status: 'not-loaded' };
    }

    const [geoDocs, venues, rejections, sweeps] = await Promise.all([
      MapListing.aggregate<GeoAggListingDoc>(buildDiscoverGeoPipeline(params)).exec(),
      venueModel.Schema.find({}, { name: 1, city: 1 }).lean().exec(),
      MapListingRejection.find({}, { listingId: 1 }).lean().exec(),
      VenueMiningSweep.find({}, { excludeKeywords: 1 }).lean().exec(),
    ]);

    const rejectedIds = new Set(
      (rejections as RejectionIdDoc[])
        .map((r) => (typeof r.listingId === 'string' ? r.listingId : ''))
        .filter(Boolean),
    );

    const sweepExcludeKeywords: string[] = [];
    for (const sweep of sweeps as SweepKeywordsDoc[]) {
      if (Array.isArray(sweep.excludeKeywords)) {
        for (const kw of sweep.excludeKeywords) {
          if (typeof kw === 'string' && kw.trim()) {
            sweepExcludeKeywords.push(kw);
          }
        }
      }
    }

    const rows: DiscoverListingRow[] = [];
    for (const doc of geoDocs) {
      if (isExcludedByKeywords(doc.name, sweepExcludeKeywords)) continue;
      if (isDuplicateOfExistingVenue(doc.name, doc.city, venues as VenueNameCity[])) continue;
      const isRejected = rejectedIds.has(doc.listingId);
      if (isRejected && !params.showRejected) continue;
      rows.push(toDiscoverRow(doc, isRejected));
    }

    return {
      status: 'ok',
      rows,
      lastDownloadedAt: copyStatus.lastDownloadedAt.toISOString(),
      copyRadiusMiles: MAP_LISTING_MAX_RADIUS_MILES,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function rejectDiscoverListing(
  listingId: string,
  rejectedBy: string,
): Promise<RejectDiscoverListingOutcome> {
  try {
    const copyStatus = await getListingsCopyStatus();
    if (!copyStatus.loaded) {
      return { status: 'not-loaded' };
    }

    const listing = await MapListing.findOne(
      { listingId },
      { listingId: 1, name: 1 },
    ).lean().exec() as { listingId?: string; name?: string } | null;

    if (!listing || !listing.name) {
      return { status: 'not-found' };
    }

    const existing = await MapListingRejection.findOne({ listingId }, { _id: 1 }).lean().exec();
    const saved = await MapListingRejection.findOneAndUpdate(
      { listingId },
      {
        $set: {
          listingId,
          name: listing.name,
          rejectedBy,
          rejectedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean().exec() as unknown as RejectListingResult;

    return {
      status: existing ? 'updated' : 'created',
      rejection: {
        listingId: saved.listingId,
        name: saved.name,
        rejectedBy: saved.rejectedBy,
        rejectedAt: saved.rejectedAt,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function undoRejectDiscoverListing(
  listingId: string,
): Promise<UndoRejectDiscoverListingOutcome> {
  try {
    const copyStatus = await getListingsCopyStatus();
    if (!copyStatus.loaded) {
      return { status: 'not-loaded' };
    }

    const deleted = await MapListingRejection.findOneAndDelete({ listingId })
      .lean()
      .exec() as { listingId?: string } | null;

    if (!deleted) {
      return { status: 'not-found' };
    }

    return {
      status: 'deleted',
      listingId: deleted.listingId || listingId,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

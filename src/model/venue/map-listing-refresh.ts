import crypto from 'node:crypto';
import MapListing, {
  MAP_LISTING_KINDS,
  type MapListingKind,
  type MapListingRecord,
} from '#src/model/venue/map-listing-schema.js';

export const OVERTURE_STAC_CATALOG_URL = 'https://stac.overturemaps.org/catalog.json';
export const OVERTURE_S3_BUCKET_REGION = 'us-west-2';
export const SALEM_VA_COORDINATES = {
  latitude: 37.2935,
  longitude: -80.0548,
} as const;
export const MAP_LISTING_MAX_RADIUS_MILES = 200;
export const MAP_LISTING_LOCK_ID = '__overture_refresh_lock__';
export const DEFAULT_REFRESH_LOCK_TTL_MS = 30 * 60 * 1000;

const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const BULK_WRITE_BATCH_SIZE = 1000;

interface ModelRefreshState {
  lastIssuedAtMs: number;
  lastCommittedAtMs: number;
}

const modelRefreshStates = new WeakMap<MapListingModelLike, ModelRefreshState>();

function getModelRefreshState(model: MapListingModelLike): ModelRefreshState {
  let state = modelRefreshStates.get(model);
  if (!state) {
    state = { lastIssuedAtMs: 0, lastCommittedAtMs: 0 };
    modelRefreshStates.set(model, state);
  }
  return state;
}
const OPTIONAL_LISTING_FIELDS = [
  'city',
  'state',
  'zipCode',
  'website',
  'email',
  'phone',
] as const;

const KIND_SET: ReadonlySet<string> = new Set<string>(MAP_LISTING_KINDS);

export interface OvertureCatalogLink {
  rel?: string;
  title?: string;
  latest?: boolean;
}

export interface OvertureStacCatalog {
  latest?: string;
  links?: OvertureCatalogLink[];
}

export interface RawOvertureListingRow {
  listingId?: unknown;
  id?: unknown;
  name?: unknown;
  street?: unknown;
  city?: unknown;
  state?: unknown;
  zipCode?: unknown;
  website?: unknown;
  email?: unknown;
  phone?: unknown;
  kind?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  location?: {
    type?: unknown;
    coordinates?: unknown;
  };
}

export interface OvertureDownloadAnswer {
  release: string;
  rows: RawOvertureListingRow[];
}

export interface MapListingBulkOperation {
  updateOne: {
    filter: {
      listingId: string;
      $or: Array<
        | { downloadedAt: { $lte: Date } }
        | { downloadedAt: { $exists: false } }
      >;
    };
    update: {
      $set: MapListingRecord;
      $unset?: Record<string, 1>;
    };
    upsert: true;
  };
}

export interface MapListingModelLike {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null>;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
  bulkWrite(ops: MapListingBulkOperation[], options?: { ordered?: boolean }): Promise<unknown>;
  deleteMany(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<{ deletedCount?: number }>;
}

export interface RefreshMapListingsOptions {
  fetchAnswer: () => Promise<OvertureDownloadAnswer>;
  model?: MapListingModelLike;
  now?: () => Date;
  batchSize?: number;
  ownerId?: string;
  lockTtlMs?: number;
}

export interface RefreshMapListingsResult {
  release: string;
  downloadedAt: Date;
  previousCount: number;
  written: number;
  removed: number;
}

export function parseOvertureCatalogRelease(catalog: unknown): string {
  if (!catalog || typeof catalog !== 'object') {
    throw new Error('Overture STAC catalog payload must be a JSON object.');
  }
  const obj = catalog as OvertureStacCatalog;
  const direct = typeof obj.latest === 'string' ? obj.latest.trim() : '';
  const fallbackLink = Array.isArray(obj.links)
    ? obj.links.find((l) => l && l.rel === 'child' && l.latest === true && typeof l.title === 'string')
    : undefined;
  const candidate = direct || (fallbackLink?.title?.trim() ?? '');
  if (!candidate || !RELEASE_PATTERN.test(candidate)) {
    throw new Error(`Overture STAC catalog is missing a valid release identifier (got "${candidate}").`);
  }
  return candidate;
}

export async function fetchLatestOvertureRelease(
  catalogUrl: string = OVERTURE_STAC_CATALOG_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(catalogUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Overture STAC catalog from ${catalogUrl}: HTTP ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return parseOvertureCatalogRelease(payload);
}

export function buildOvertureDuckDbQuery(release: string): string {
  if (!RELEASE_PATTERN.test(release)) {
    throw new Error(`Invalid Overture release identifier: "${release}"`);
  }
  const s3Path = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
  const kindsSql = MAP_LISTING_KINDS.map((k) => `'${k}'`).join(', ');
  const { latitude, longitude } = SALEM_VA_COORDINATES;
  const minLat = (latitude - 2.95).toFixed(4);
  const maxLat = (latitude + 2.95).toFixed(4);
  const minLng = (longitude - 3.75).toFixed(4);
  const maxLng = (longitude + 3.75).toFixed(4);

  return [
    'INSTALL httpfs;',
    'LOAD httpfs;',
    `SET s3_region='${OVERTURE_S3_BUCKET_REGION}';`,
    'SELECT',
    '  id AS listingId,',
    '  TRIM(names.primary) AS name,',
    '  TRIM(addresses[1].freeform) AS street,',
    '  NULLIF(TRIM(addresses[1].locality), \'\') AS city,',
    '  NULLIF(TRIM(addresses[1].region), \'\') AS state,',
    '  NULLIF(TRIM(addresses[1].postcode), \'\') AS zipCode,',
    '  NULLIF(TRIM(websites[1]), \'\') AS website,',
    '  NULLIF(LOWER(TRIM(emails[1])), \'\') AS email,',
    '  NULLIF(TRIM(phones[1]), \'\') AS phone,',
    '  COALESCE(basic_category, taxonomy.primary) AS kind,',
    '  CAST(bbox.xmin AS DOUBLE) AS longitude,',
    '  CAST(bbox.ymin AS DOUBLE) AS latitude',
    `FROM read_parquet('${s3Path}', filename=false, hive_partitioning=1)`,
    'WHERE operating_status = \'open\'',
    `  AND COALESCE(basic_category, taxonomy.primary) IN (${kindsSql})`,
    `  AND bbox.ymin BETWEEN ${minLat} AND ${maxLat}`,
    `  AND bbox.xmin BETWEEN ${minLng} AND ${maxLng}`,
    '  AND names.primary IS NOT NULL',
    '  AND TRIM(names.primary) <> \'\'',
    '  AND addresses IS NOT NULL',
    '  AND len(addresses) >= 1',
    '  AND addresses[1].freeform IS NOT NULL',
    '  AND TRIM(addresses[1].freeform) <> \'\'',
    '  AND 2 * 3958.7613 * ASIN(SQRT(',
    `    POWER(SIN(RADIANS((CAST(bbox.ymin AS DOUBLE) - (${latitude})) / 2)), 2) +`,
    `    COS(RADIANS(${latitude})) * COS(RADIANS(CAST(bbox.ymin AS DOUBLE))) *`,
    `    POWER(SIN(RADIANS((CAST(bbox.xmin AS DOUBLE) - (${longitude})) / 2)), 2)`,
    `  )) <= ${MAP_LISTING_MAX_RADIUS_MILES};`,
  ].join('\n');
}

function cleanOptionalString(value: unknown, lowercase = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return lowercase ? trimmed.toLowerCase() : trimmed;
}

function extractCoordinates(raw: RawOvertureListingRow): [number, number] | null {
  const rawCoords = raw.location && Array.isArray(raw.location.coordinates)
    ? raw.location.coordinates
    : [raw.longitude, raw.latitude];
  if (rawCoords.length !== 2) return null;
  const lng = Number(rawCoords[0]);
  const lat = Number(rawCoords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

export function isMapListingKind(value: unknown): value is MapListingKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

export function normalizeMapListing(
  raw: RawOvertureListingRow,
  release: string,
  downloadedAt: Date,
): MapListingRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const listingId = cleanOptionalString(raw.listingId ?? raw.id);
  const name = cleanOptionalString(raw.name);
  const street = cleanOptionalString(raw.street);
  if (!listingId || listingId === MAP_LISTING_LOCK_ID || !name || !street) {
    return null;
  }

  const kindValue = cleanOptionalString(raw.kind);
  if (!isMapListingKind(kindValue)) {
    return null;
  }

  const coordinates = extractCoordinates(raw);
  if (!coordinates) {
    return null;
  }

  const record: MapListingRecord = {
    listingId,
    name,
    street,
    kind: kindValue,
    location: {
      type: 'Point',
      coordinates,
    },
    release: release.trim(),
    downloadedAt,
  };

  const city = cleanOptionalString(raw.city);
  if (city) record.city = city;
  const state = cleanOptionalString(raw.state);
  if (state) record.state = state;
  const zipCode = cleanOptionalString(raw.zipCode);
  if (zipCode) record.zipCode = zipCode;
  const website = cleanOptionalString(raw.website);
  if (website) record.website = website;
  const email = cleanOptionalString(raw.email, true);
  if (email) record.email = email;
  const phone = cleanOptionalString(raw.phone);
  if (phone) record.phone = phone;

  return record;
}

function buildUpsertOperation(record: MapListingRecord): MapListingBulkOperation {
  const unset: Record<string, 1> = {};
  for (const field of OPTIONAL_LISTING_FIELDS) {
    if (record[field] === undefined) {
      unset[field] = 1;
    }
  }
  const update: MapListingBulkOperation['updateOne']['update'] = { $set: record };
  if (Object.keys(unset).length > 0) {
    update.$unset = unset;
  }
  return {
    updateOne: {
      filter: {
        listingId: record.listingId,
        $or: [
          { downloadedAt: { $lte: record.downloadedAt } },
          { downloadedAt: { $exists: false } },
        ],
      },
      update,
      upsert: true,
    },
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeErr = err as { code?: number; message?: string };
  return maybeErr.code === 11000 || /E11000|duplicate key/i.test(maybeErr.message ?? '');
}

async function acquireRefreshLock(
  model: MapListingModelLike,
  ownerId: string,
  acquiredAt: Date,
  lockTtlMs: number,
): Promise<number> {
  const expiresAt = new Date(acquiredAt.getTime() + lockTtlMs);
  let lockDoc: Record<string, unknown> | null = null;
  try {
    lockDoc = await model.findOneAndUpdate(
      {
        listingId: MAP_LISTING_LOCK_ID,
        $or: [
          { lockExpiresAt: { $lte: acquiredAt } },
          { lockExpiresAt: { $exists: false } },
        ],
      },
      {
        $set: {
          listingId: MAP_LISTING_LOCK_ID,
          lockOwner: ownerId,
          lockedAt: acquiredAt,
          lockExpiresAt: expiresAt,
        },
        $inc: {
          lockEpoch: 1,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        lean: true,
        strict: false,
      },
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new Error('Refusing to refresh mapListing: another refresh is already in progress.');
    }
    throw err;
  }
  if (!lockDoc || lockDoc.lockOwner !== ownerId) {
    throw new Error('Refusing to refresh mapListing: another refresh is already in progress.');
  }
  return typeof lockDoc.lockEpoch === 'number' ? lockDoc.lockEpoch : 1;
}

async function assertRefreshLockHeld(
  model: MapListingModelLike,
  ownerId: string,
  lockEpoch: number,
  currentTime: Date,
  lockTtlMs: number,
): Promise<void> {
  const expiresAt = new Date(currentTime.getTime() + lockTtlMs);
  const lockDoc = await model.findOneAndUpdate(
    {
      listingId: MAP_LISTING_LOCK_ID,
      lockOwner: ownerId,
      lockEpoch,
      lockExpiresAt: { $gt: currentTime },
    },
    {
      $set: {
        lockExpiresAt: expiresAt,
      },
    },
    {
      upsert: false,
      returnDocument: 'after',
      lean: true,
      strict: false,
    },
  );
  if (!lockDoc || lockDoc.lockOwner !== ownerId || lockDoc.lockEpoch !== lockEpoch) {
    throw new Error('Refusing to refresh mapListing: refresh lock expired or ownership was lost.');
  }
}

async function releaseRefreshLock(
  model: MapListingModelLike,
  ownerId: string,
  lockEpoch: number,
): Promise<void> {
  await model.deleteMany(
    {
      listingId: MAP_LISTING_LOCK_ID,
      lockOwner: ownerId,
      lockEpoch,
    },
    { strict: false },
  );
}

function resolveRefreshTimestamp(
  model: MapListingModelLike,
  rawDownloadedAt: Date,
  lockEpoch: number,
): Date {
  const state = getModelRefreshState(model);
  const rawMs = rawDownloadedAt.getTime();
  const resolvedMs = (lockEpoch > 1 && rawMs <= state.lastIssuedAtMs) || rawMs < state.lastIssuedAtMs
    ? state.lastIssuedAtMs + 1
    : rawMs;
  state.lastIssuedAtMs = resolvedMs;
  return new Date(resolvedMs);
}

function recordCommittedRefresh(model: MapListingModelLike, downloadedAt: Date): void {
  const state = getModelRefreshState(model);
  state.lastCommittedAtMs = Math.max(state.lastCommittedAtMs, downloadedAt.getTime());
}

function validateAndNormalizeAnswer(
  answer: OvertureDownloadAnswer,
  downloadedAt: Date,
): { release: string; listings: MapListingRecord[] } {
  const release = answer.release?.trim();
  if (!release || !RELEASE_PATTERN.test(release)) {
    throw new Error(`Refusing to refresh mapListing: invalid Overture release "${answer.release}".`);
  }
  if (!Array.isArray(answer.rows)) {
    throw new TypeError('Refusing to refresh mapListing: downloaded rows payload is not an array.');
  }
  const byId = new Map<string, MapListingRecord>();
  for (const rawRow of answer.rows) {
    const normalized = normalizeMapListing(rawRow, release, downloadedAt);
    if (normalized) {
      byId.set(normalized.listingId, normalized);
    }
  }
  return { release, listings: [...byId.values()] };
}

function assertAnswerMeetsThreshold(listingCount: number, previousCount: number): void {
  if (listingCount === 0) {
    throw new Error(
      `Refusing to refresh mapListing: answer contained 0 valid listings (existing copy holds ${previousCount}).`,
    );
  }
  if (previousCount > 0 && listingCount < previousCount / 2) {
    throw new Error(
      `Refusing to refresh mapListing: answer contained ${listingCount} listings, under half of the ${previousCount} listings currently held.`,
    );
  }
}

async function rollbackStaleBatchIfSuperseded(
  model: MapListingModelLike,
  wroteAnyBatch: boolean,
  downloadedAt: Date | undefined,
): Promise<void> {
  if (!wroteAnyBatch || !downloadedAt) return;
  const state = getModelRefreshState(model);
  if (state.lastCommittedAtMs <= downloadedAt.getTime()) {
    return;
  }
  await model.deleteMany({
    listingId: { $ne: MAP_LISTING_LOCK_ID },
    downloadedAt,
  });
}

export async function refreshMapListings(
  options: RefreshMapListingsOptions,
): Promise<RefreshMapListingsResult> {
  const model = (options.model ?? (MapListing as unknown as MapListingModelLike));
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? BULK_WRITE_BATCH_SIZE;
  const ownerId = options.ownerId ?? crypto.randomUUID();
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_REFRESH_LOCK_TTL_MS;

  const lockEpoch = await acquireRefreshLock(model, ownerId, now(), lockTtlMs);
  let downloadedAt: Date | undefined;
  let wroteAnyBatch = false;
  try {
    const answer = await options.fetchAnswer();
    const rawDownloadedAt = now();
    downloadedAt = resolveRefreshTimestamp(model, rawDownloadedAt, lockEpoch);
    await assertRefreshLockHeld(model, ownerId, lockEpoch, rawDownloadedAt, lockTtlMs);

    const { release, listings } = validateAndNormalizeAnswer(answer, downloadedAt);
    const previousCount = await model.countDocuments({
      listingId: { $ne: MAP_LISTING_LOCK_ID },
    });
    assertAnswerMeetsThreshold(listings.length, previousCount);

    for (let i = 0; i < listings.length; i += batchSize) {
      // eslint-disable-next-line no-await-in-loop
      await assertRefreshLockHeld(model, ownerId, lockEpoch, now(), lockTtlMs);
      const slice = listings.slice(i, i + batchSize);
      const ops = slice.map(buildUpsertOperation);
      wroteAnyBatch = true;
      // eslint-disable-next-line no-await-in-loop
      await model.bulkWrite(ops, { ordered: false });
    }

    await assertRefreshLockHeld(model, ownerId, lockEpoch, now(), lockTtlMs);
    const keptIds = [...listings.map((item) => item.listingId), MAP_LISTING_LOCK_ID];
    const deleteResult = await model.deleteMany({
      listingId: { $nin: keptIds },
      $or: [
        { downloadedAt: { $lte: downloadedAt } },
        { downloadedAt: { $exists: false } },
      ],
    });
    await assertRefreshLockHeld(model, ownerId, lockEpoch, now(), lockTtlMs);
    recordCommittedRefresh(model, downloadedAt);

    return {
      release,
      downloadedAt,
      previousCount,
      written: listings.length,
      removed: deleteResult.deletedCount ?? 0,
    };
  } catch (err) {
    await rollbackStaleBatchIfSuperseded(model, wroteAnyBatch, downloadedAt);
    throw err;
  } finally {
    await releaseRefreshLock(model, ownerId, lockEpoch);
  }
}

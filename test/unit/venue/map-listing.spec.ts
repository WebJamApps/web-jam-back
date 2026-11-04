import { vi } from 'vitest';
import MapListing, {
  DISCOVER_LISTING_KINDS,
  MAP_LISTING_COLLECTION,
  MAP_LISTING_KINDS,
  type MapListingRecord,
} from '#src/model/venue/map-listing-schema.js';
import {
  MAP_LISTING_LOCK_ID,
  MAP_LISTING_MAX_RADIUS_MILES,
  OVERTURE_STAC_CATALOG_URL,
  SALEM_VA_COORDINATES,
  buildOvertureDuckDbQuery,
  fetchLatestOvertureRelease,
  isMapListingKind,
  normalizeMapListing,
  parseOvertureCatalogRelease,
  refreshMapListings,
  type MapListingBulkOperation,
  type MapListingModelLike,
  type RawOvertureListingRow,
} from '#src/model/venue/map-listing-refresh.js';

interface StoredLockDoc {
  listingId: string;
  lockOwner: string;
  lockedAt: Date;
  lockExpiresAt: Date;
}

class InMemoryMapListingStore implements MapListingModelLike {
  docs = new Map<string, MapListingRecord>();

  lockDoc: StoredLockDoc | null = null;

  bulkWriteCalls: MapListingBulkOperation[][] = [];

  deleteManyCalls: Record<string, unknown>[] = [];

  constructor(initial: MapListingRecord[] = []) {
    for (const item of initial) {
      this.docs.set(item.listingId, { ...item });
    }
  }

  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (filter.listingId !== MAP_LISTING_LOCK_ID) {
      return Promise.resolve(null);
    }
    const orClauses = filter.$or as Array<{ lockExpiresAt?: { $lte?: Date } }> | undefined;
    const cutoff = orClauses?.[0]?.lockExpiresAt?.$lte;
    if (this.lockDoc && cutoff && this.lockDoc.lockExpiresAt > cutoff) {
      const dupErr = Object.assign(
        new Error('E11000 duplicate key error collection: webjamsalem.mapListing index: listingId_1'),
        { code: 11000 },
      );
      return Promise.reject(dupErr);
    }
    const setFields = (update.$set ?? {}) as unknown as StoredLockDoc;
    this.lockDoc = { ...setFields };
    return Promise.resolve({ ...this.lockDoc });
  }

  countDocuments(): Promise<number> {
    return Promise.resolve(this.docs.size);
  }

  bulkWrite(ops: MapListingBulkOperation[]): Promise<unknown> {
    this.bulkWriteCalls.push(ops);
    for (const op of ops) {
      const id = op.updateOne.filter.listingId;
      const existing = this.docs.get(id);
      const merged: MapListingRecord = existing
        ? { ...existing, ...op.updateOne.update.$set }
        : { ...op.updateOne.update.$set };
      if (op.updateOne.update.$unset) {
        for (const key of Object.keys(op.updateOne.update.$unset)) {
          delete (merged as unknown as Record<string, unknown>)[key];
        }
      }
      this.docs.set(id, merged);
    }
    return Promise.resolve({ ok: 1 });
  }

  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }> {
    if (filter.listingId === MAP_LISTING_LOCK_ID) {
      if (this.lockDoc && this.lockDoc.lockOwner === filter.lockOwner) {
        this.lockDoc = null;
        return Promise.resolve({ deletedCount: 1 });
      }
      return Promise.resolve({ deletedCount: 0 });
    }
    this.deleteManyCalls.push(filter);
    const ninSpec = filter.listingId as { $nin?: string[] } | undefined;
    const kept = new Set(ninSpec?.$nin ?? []);
    let deletedCount = 0;
    for (const id of [...this.docs.keys()]) {
      if (!kept.has(id)) {
        this.docs.delete(id);
        deletedCount += 1;
      }
    }
    return Promise.resolve({ deletedCount });
  }

  snapshot(): MapListingRecord[] {
    return [...this.docs.values()].sort((a, b) => a.listingId.localeCompare(b.listingId));
  }
}

const SAMPLE_RELEASE = '2026-10-21.0';
const SAMPLE_DOWNLOADED_AT = new Date('2026-11-02T06:00:00.000Z');

function sampleRow(overrides: Partial<RawOvertureListingRow> = {}): RawOvertureListingRow {
  return {
    listingId: 'overture-parkway-1',
    name: 'Parkway Brewing Company',
    street: '739 Kessler Mill Rd',
    city: 'Salem',
    state: 'VA',
    zipCode: '24153',
    website: 'https://parkwaybrewing.com',
    email: 'Booking@ParkwayBrewing.com',
    phone: '540-387-2739',
    kind: 'brewery',
    longitude: -80.0419,
    latitude: 37.2912,
    ...overrides,
  };
}

function sampleStoredRecord(overrides: Partial<MapListingRecord> = {}): MapListingRecord {
  return {
    listingId: 'overture-parkway-1',
    name: 'Parkway Brewing Company',
    street: '739 Kessler Mill Rd',
    city: 'Salem',
    state: 'VA',
    zipCode: '24153',
    website: 'https://parkwaybrewing.com',
    email: 'booking@parkwaybrewing.com',
    phone: '540-387-2739',
    kind: 'brewery',
    location: {
      type: 'Point',
      coordinates: [-80.0419, 37.2912],
    },
    release: '2026-09-21.0',
    downloadedAt: new Date('2026-10-02T06:00:00.000Z'),
    ...overrides,
  };
}

describe('map-listing-schema.ts', () => {
  it('registers the mapListing collection and exports the 9 discover kinds and 29 kept kinds', () => {
    expect(MAP_LISTING_COLLECTION).toBe('mapListing');
    expect(MapListing.collection.collectionName).toBe('mapListing');
    expect(DISCOVER_LISTING_KINDS).toHaveLength(9);
    expect(MAP_LISTING_KINDS).toHaveLength(29);
    for (const kind of DISCOVER_LISTING_KINDS) {
      expect(MAP_LISTING_KINDS).toContain(kind);
    }
  });

  it('validates a complete mapListing document and lowercases email', () => {
    const doc = new MapListing({
      listingId: 'ov-123',
      name: 'Olde Salem Brewing Company',
      street: '21 E Main St',
      city: 'Salem',
      state: 'VA',
      zipCode: '24153',
      website: 'https://oldesalembrewing.com',
      email: 'Info@OldeSalemBrewing.com',
      phone: '540-404-4399',
      kind: 'brewery',
      location: {
        type: 'Point',
        coordinates: [-80.0548, 37.2935],
      },
      release: SAMPLE_RELEASE,
      downloadedAt: SAMPLE_DOWNLOADED_AT,
    });

    const err = doc.validateSync();
    expect(err).toBeUndefined();
    expect(doc.email).toBe('info@oldesalembrewing.com');
  });

  it('rejects a document with no street or invalid coordinates', () => {
    const missingStreet = new MapListing({
      listingId: 'ov-no-street',
      name: 'Mystery Venue',
      kind: 'bar',
      location: { type: 'Point', coordinates: [-80.05, 37.29] },
      release: SAMPLE_RELEASE,
      downloadedAt: SAMPLE_DOWNLOADED_AT,
    });
    expect(missingStreet.validateSync()?.errors.street).toBeDefined();

    const badCoords = new MapListing({
      listingId: 'ov-bad-coords',
      name: 'Bad Coords Venue',
      street: '100 Main St',
      kind: 'bar',
      location: { type: 'Point', coordinates: [-200, 95] },
      release: SAMPLE_RELEASE,
      downloadedAt: SAMPLE_DOWNLOADED_AT,
    });
    expect(badCoords.validateSync()?.errors['location.coordinates']).toBeDefined();
  });
});

describe('map-listing-refresh.ts: STAC release resolution and DuckDB query', () => {
  it('parses the top-level latest release from the Overture STAC catalog', () => {
    expect(parseOvertureCatalogRelease({ latest: '2026-10-21.0' })).toBe('2026-10-21.0');
  });

  it('falls back to the child link marked latest when top-level latest is absent', () => {
    const catalog = {
      links: [
        { rel: 'self', title: 'root' },
        { rel: 'child', title: '2026-09-21.0', latest: false },
        { rel: 'child', title: '2026-10-21.0', latest: true },
      ],
    };
    expect(parseOvertureCatalogRelease(catalog)).toBe('2026-10-21.0');
  });

  it('throws when the STAC catalog payload is not an object or lacks a valid release', () => {
    expect(() => parseOvertureCatalogRelease(null)).toThrow(/must be a JSON object/);
    expect(() => parseOvertureCatalogRelease({})).toThrow(/missing a valid release/);
    expect(() => parseOvertureCatalogRelease({ latest: 'not-a-release' })).toThrow(/missing a valid release/);
  });

  it('fetches the latest Overture release over HTTP and fails closed on non-2xx', async () => {
    const okFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ latest: '2026-10-21.0' }),
    });
    await expect(
      fetchLatestOvertureRelease(OVERTURE_STAC_CATALOG_URL, okFetch as unknown as typeof fetch),
    ).resolves.toBe('2026-10-21.0');

    const failFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });
    await expect(
      fetchLatestOvertureRelease(OVERTURE_STAC_CATALOG_URL, failFetch as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('builds a DuckDB query for open listings within 200 miles of Salem VA in the 29 kept kinds', () => {
    const sql = buildOvertureDuckDbQuery('2026-10-21.0');
    expect(sql).toContain('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*');
    expect(sql).toContain("operating_status = 'open'");
    expect(sql).toContain("TRIM(addresses[1].freeform) <> ''");
    expect(sql).toContain(String(SALEM_VA_COORDINATES.latitude));
    expect(sql).toContain(String(SALEM_VA_COORDINATES.longitude));
    expect(sql).toContain(`<= ${MAP_LISTING_MAX_RADIUS_MILES}`);
    for (const kind of MAP_LISTING_KINDS) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(() => buildOvertureDuckDbQuery('bad; DROP TABLE')).toThrow(/Invalid Overture release/);
  });
});

describe('map-listing-refresh.ts: normalizeMapListing', () => {
  it('normalizes a valid raw Overture row and supports GeoJSON location input', () => {
    const rec = normalizeMapListing(sampleRow(), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT);
    expect(rec).toEqual({
      listingId: 'overture-parkway-1',
      name: 'Parkway Brewing Company',
      street: '739 Kessler Mill Rd',
      city: 'Salem',
      state: 'VA',
      zipCode: '24153',
      website: 'https://parkwaybrewing.com',
      email: 'booking@parkwaybrewing.com',
      phone: '540-387-2739',
      kind: 'brewery',
      location: {
        type: 'Point',
        coordinates: [-80.0419, 37.2912],
      },
      release: SAMPLE_RELEASE,
      downloadedAt: SAMPLE_DOWNLOADED_AT,
    });

    const fromGeoJson = normalizeMapListing(
      {
        id: 'overture-2',
        name: 'The Spot on Kirk',
        street: '22 Kirk Ave SW',
        kind: 'music_venue',
        location: { type: 'Point', coordinates: [-79.9414, 37.271] },
      },
      SAMPLE_RELEASE,
      SAMPLE_DOWNLOADED_AT,
    );
    expect(fromGeoJson?.listingId).toBe('overture-2');
    expect(fromGeoJson?.location.coordinates).toEqual([-79.9414, 37.271]);
  });

  it('drops any listing with no street, missing required fields, unsupported kind, or bad coordinates', () => {
    expect(normalizeMapListing(null as unknown as RawOvertureListingRow, SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ street: '' }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ street: '   ' }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ street: undefined }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ name: '   ' }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ listingId: '' }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(
      normalizeMapListing(sampleRow({ listingId: MAP_LISTING_LOCK_ID }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT),
    ).toBeNull();
    expect(normalizeMapListing(sampleRow({ kind: 'hospital' }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ longitude: Number.NaN }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(normalizeMapListing(sampleRow({ latitude: 95 }), SAMPLE_RELEASE, SAMPLE_DOWNLOADED_AT)).toBeNull();
    expect(
      normalizeMapListing(
        sampleRow({ location: { type: 'Point', coordinates: [-80.04] } }),
        SAMPLE_RELEASE,
        SAMPLE_DOWNLOADED_AT,
      ),
    ).toBeNull();
    expect(isMapListingKind('brewery')).toBe(true);
    expect(isMapListingKind('arcade')).toBe(true);
    expect(isMapListingKind('dentist')).toBe(false);
  });
});

describe('map-listing-refresh.ts: refreshMapListings outcomes table', () => {
  it('writes each listing by ID, removes absent listings, and saves release and downloadedAt on a complete answer', async () => {
    const store = new InMemoryMapListingStore([
      sampleStoredRecord({ listingId: 'overture-parkway-1', phone: '540-000-0000' }),
      sampleStoredRecord({ listingId: 'overture-closed-2', name: 'Closed Venue', street: '1 Old Way' }),
    ]);

    const result = await refreshMapListings({
      model: store,
      now: () => SAMPLE_DOWNLOADED_AT,
      batchSize: 1,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({
            listingId: 'overture-parkway-1',
            phone: undefined,
          }),
          sampleRow({
            listingId: 'overture-kirk-3',
            name: 'The Spot on Kirk',
            street: '22 Kirk Ave SW',
            city: 'Roanoke',
            kind: 'music_venue',
          }),
          // Listing without a street in the raw answer is dropped and not written:
          sampleRow({
            listingId: 'overture-no-street-4',
            name: 'Streetless Place',
            street: '   ',
          }),
        ],
      }),
    });

    expect(result).toEqual({
      release: SAMPLE_RELEASE,
      downloadedAt: SAMPLE_DOWNLOADED_AT,
      previousCount: 2,
      written: 2,
      removed: 1,
    });
    expect(store.bulkWriteCalls).toHaveLength(2);
    const current = store.snapshot();
    expect(current.map((d) => d.listingId)).toEqual(['overture-kirk-3', 'overture-parkway-1']);
    expect(current[0].release).toBe(SAMPLE_RELEASE);
    expect(current[0].downloadedAt).toEqual(SAMPLE_DOWNLOADED_AT);
    expect(current[1].release).toBe(SAMPLE_RELEASE);
    expect(current[1].downloadedAt).toEqual(SAMPLE_DOWNLOADED_AT);
    expect(current[1].phone).toBeUndefined();
  });

  it('leaves existing mapListing documents unchanged and rejects when the download fails', async () => {
    const initial = [
      sampleStoredRecord({ listingId: 'overture-parkway-1' }),
      sampleStoredRecord({ listingId: 'overture-kirk-2', name: 'The Spot on Kirk', street: '22 Kirk Ave SW' }),
    ];
    const store = new InMemoryMapListingStore(initial);

    await expect(
      refreshMapListings({
        model: store,
        fetchAnswer: () => Promise.reject(new Error('S3 connection reset')),
      }),
    ).rejects.toThrow('S3 connection reset');

    expect(store.bulkWriteCalls).toEqual([]);
    expect(store.deleteManyCalls).toEqual([]);
    expect(store.snapshot()).toEqual(initial.sort((a, b) => a.listingId.localeCompare(b.listingId)));
  });

  it('leaves existing mapListing documents unchanged when the answer has no listings', async () => {
    const initial = [
      sampleStoredRecord({ listingId: 'overture-parkway-1' }),
      sampleStoredRecord({ listingId: 'overture-kirk-2', name: 'The Spot on Kirk', street: '22 Kirk Ave SW' }),
    ];
    const store = new InMemoryMapListingStore(initial);

    await expect(
      refreshMapListings({
        model: store,
        now: () => SAMPLE_DOWNLOADED_AT,
        fetchAnswer: () => Promise.resolve({
          release: SAMPLE_RELEASE,
          rows: [],
        }),
      }),
    ).rejects.toThrow(/0 valid listings/);

    expect(store.bulkWriteCalls).toEqual([]);
    expect(store.deleteManyCalls).toEqual([]);
    expect(store.snapshot()).toEqual(initial.sort((a, b) => a.listingId.localeCompare(b.listingId)));
  });

  it('leaves existing mapListing documents unchanged when the answer has under half as many as the copy holds', async () => {
    const initial = [
      sampleStoredRecord({ listingId: 'ov-1' }),
      sampleStoredRecord({ listingId: 'ov-2' }),
      sampleStoredRecord({ listingId: 'ov-3' }),
      sampleStoredRecord({ listingId: 'ov-4' }),
    ];
    const store = new InMemoryMapListingStore(initial);

    await expect(
      refreshMapListings({
        model: store,
        now: () => SAMPLE_DOWNLOADED_AT,
        fetchAnswer: () => Promise.resolve({
          release: SAMPLE_RELEASE,
          rows: [sampleRow({ listingId: 'ov-1' })],
        }),
      }),
    ).rejects.toThrow(/under half of the 4 listings currently held/);

    expect(store.bulkWriteCalls).toEqual([]);
    expect(store.deleteManyCalls).toEqual([]);
    expect(store.snapshot()).toEqual(initial);
  });

  it('rejects invalid release strings or non-array row payloads without touching the copy', async () => {
    const initial = [sampleStoredRecord({ listingId: 'ov-1' })];
    const store = new InMemoryMapListingStore(initial);

    await expect(
      refreshMapListings({
        model: store,
        fetchAnswer: () => Promise.resolve({ release: 'bad-release', rows: [sampleRow()] }),
      }),
    ).rejects.toThrow(/invalid Overture release/);

    await expect(
      refreshMapListings({
        model: store,
        fetchAnswer: () => Promise.resolve({
          release: SAMPLE_RELEASE,
          rows: 'not-an-array' as unknown as RawOvertureListingRow[],
        }),
      }),
    ).rejects.toThrow(/not an array/);

    expect(store.bulkWriteCalls).toEqual([]);
    expect(store.deleteManyCalls).toEqual([]);
    expect(store.snapshot()).toEqual(initial);
  });

  it('prevents overlapping writers from interleaving upserts and prunes, preserving a complete answer', async () => {
    const store = new InMemoryMapListingStore([
      sampleStoredRecord({ listingId: 'ov-A', name: 'Venue A' }),
      sampleStoredRecord({ listingId: 'ov-B', name: 'Venue B' }),
    ]);

    let releaseWriter1Fetch: () => void = () => undefined;
    const writer1FetchEntered = new Promise<void>((resolve) => {
      releaseWriter1Fetch = resolve;
    });

    let resumeWriter1: () => void = () => undefined;
    const writer1CanFinishFetch = new Promise<void>((resolve) => {
      resumeWriter1 = resolve;
    });

    const writer1Promise = refreshMapListings({
      model: store,
      ownerId: 'writer-1',
      now: () => SAMPLE_DOWNLOADED_AT,
      fetchAnswer: async () => {
        releaseWriter1Fetch();
        await writer1CanFinishFetch;
        return {
          release: SAMPLE_RELEASE,
          rows: [
            sampleRow({ listingId: 'ov-A', name: 'Venue A' }),
            sampleRow({ listingId: 'ov-B', name: 'Venue B' }),
          ],
        };
      },
    });

    await writer1FetchEntered;
    expect(store.lockDoc?.lockOwner).toBe('writer-1');

    // Overlapping Writer 2 attempts to refresh with {B, C} while Writer 1 holds the lock:
    const writer2Fetch = vi.fn().mockResolvedValue({
      release: SAMPLE_RELEASE,
      rows: [
        sampleRow({ listingId: 'ov-B', name: 'Venue B' }),
        sampleRow({ listingId: 'ov-C', name: 'Venue C' }),
      ],
    });

    await expect(
      refreshMapListings({
        model: store,
        ownerId: 'writer-2',
        now: () => SAMPLE_DOWNLOADED_AT,
        fetchAnswer: writer2Fetch,
      }),
    ).rejects.toThrow(/another refresh is already in progress/);

    expect(writer2Fetch).not.toHaveBeenCalled();

    // Let Writer 1 complete; its answer {A, B} is written intact and the lock is released:
    resumeWriter1();
    const writer1Result = await writer1Promise;
    expect(writer1Result.written).toBe(2);
    expect(store.lockDoc).toBeNull();
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-A', 'ov-B']);

    // Once Writer 1 has finished and released the lock, a subsequent sequential run with {B, C} succeeds:
    const sequentialResult = await refreshMapListings({
      model: store,
      ownerId: 'writer-3',
      now: () => SAMPLE_DOWNLOADED_AT,
      fetchAnswer: writer2Fetch,
    });
    expect(sequentialResult).toMatchObject({ written: 2, removed: 1 });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.lockDoc).toBeNull();
  });

  it('reclaims an expired refresh lock and propagates non-duplicate lock errors', async () => {
    const store = new InMemoryMapListingStore([sampleStoredRecord({ listingId: 'ov-1' })]);
    store.lockDoc = {
      listingId: MAP_LISTING_LOCK_ID,
      lockOwner: 'crashed-writer',
      lockedAt: new Date('2026-11-02T05:00:00.000Z'),
      lockExpiresAt: new Date('2026-11-02T05:30:00.000Z'),
    };

    const result = await refreshMapListings({
      model: store,
      ownerId: 'recovered-writer',
      now: () => SAMPLE_DOWNLOADED_AT,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [sampleRow({ listingId: 'ov-1' })],
      }),
    });
    expect(result.written).toBe(1);
    expect(store.lockDoc).toBeNull();

    // When findOneAndUpdate returns null or a mismatched owner without throwing, refuse:
    const nullLockStore: MapListingModelLike = {
      findOneAndUpdate: () => Promise.resolve(null),
      countDocuments: () => Promise.resolve(0),
      bulkWrite: () => Promise.resolve({}),
      deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    };
    await expect(
      refreshMapListings({
        model: nullLockStore,
        fetchAnswer: () => Promise.resolve({ release: SAMPLE_RELEASE, rows: [sampleRow()] }),
      }),
    ).rejects.toThrow(/another refresh is already in progress/);

    // When findOneAndUpdate throws an unexpected non-11000 error, propagate it:
    const failingLockStore: MapListingModelLike = {
      findOneAndUpdate: () => Promise.reject(new Error('Mongo network timeout')),
      countDocuments: () => Promise.resolve(0),
      bulkWrite: () => Promise.resolve({}),
      deleteMany: () => Promise.resolve({ deletedCount: 0 }),
    };
    await expect(
      refreshMapListings({
        model: failingLockStore,
        fetchAnswer: () => Promise.resolve({ release: SAMPLE_RELEASE, rows: [sampleRow()] }),
      }),
    ).rejects.toThrow('Mongo network timeout');
  });
});

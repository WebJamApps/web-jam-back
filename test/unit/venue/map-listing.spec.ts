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
  lockOwner: string | null;
  lockEpoch: number;
  lockedAt: Date;
  lockExpiresAt: Date;
  lastIssuedAt?: Date;
  lastPruningAt?: Date;
  lastCommittedAt?: Date;
}

class InMemoryMapListingStore implements MapListingModelLike {
  docs = new Map<string, MapListingRecord>();

  lockDoc: StoredLockDoc | null = null;

  bulkWriteCalls: MapListingBulkOperation[][] = [];

  deleteManyCalls: Record<string, unknown>[] = [];

  onBeforeBulkWrite?: (ops: MapListingBulkOperation[]) => Promise<void>;

  onAfterBulkWrite?: (ops: MapListingBulkOperation[]) => Promise<void>;

  onBeforeDeleteMany?: (filter: Record<string, unknown>) => Promise<void>;

  onAfterDeleteMany?: (filter: Record<string, unknown>) => Promise<void>;

  constructor(initial: MapListingRecord[] = []) {
    for (const item of initial) {
      this.docs.set(item.listingId, { ...item });
    }
  }

  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (filter.listingId !== MAP_LISTING_LOCK_ID) {
      return Promise.resolve(null);
    }
    const isUpsert = options?.upsert === true;
    if (!isUpsert) {
      const gtDate = (filter.lockExpiresAt as { $gt?: Date } | undefined)?.$gt;
      const gtCommittedAt = (filter.lastCommittedAt as { $gt?: Date } | undefined)?.$gt;
      const orClauses = filter.$or as Array<{
        lastCommittedAt?: { $gt?: Date };
        lastPruningAt?: { $gt?: Date };
      }> | undefined;
      const matchesOr = !orClauses || orClauses.some((clause) => {
        const committedGt = clause.lastCommittedAt?.$gt;
        if (committedGt && this.lockDoc?.lastCommittedAt && this.lockDoc.lastCommittedAt > committedGt) {
          return true;
        }
        const pruningGt = clause.lastPruningAt?.$gt;
        if (pruningGt && this.lockDoc?.lastPruningAt && this.lockDoc.lastPruningAt > pruningGt) {
          return true;
        }
        return false;
      });
      if (
        !this.lockDoc
        || ('lockOwner' in filter && this.lockDoc.lockOwner !== filter.lockOwner)
        || (typeof filter.lockEpoch === 'number' && this.lockDoc.lockEpoch !== filter.lockEpoch)
        || (gtDate && this.lockDoc.lockExpiresAt <= gtDate)
        || (gtCommittedAt && (!this.lockDoc.lastCommittedAt || this.lockDoc.lastCommittedAt <= gtCommittedAt))
        || !matchesOr
      ) {
        return Promise.resolve(null);
      }
      const setFields = (update.$set ?? {}) as Partial<StoredLockDoc>;
      this.lockDoc = { ...this.lockDoc, ...setFields };
      return Promise.resolve({ ...this.lockDoc });
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
    const setFields = (update.$set ?? {}) as Omit<StoredLockDoc, 'lockEpoch'>;
    const incEpoch = ((update.$inc as { lockEpoch?: number } | undefined)?.lockEpoch ?? 1);
    const nextEpoch = (this.lockDoc?.lockEpoch ?? 0) + incEpoch;
    this.lockDoc = {
      ...this.lockDoc,
      ...setFields,
      lockEpoch: nextEpoch,
    };
    return Promise.resolve({ ...this.lockDoc });
  }

  countDocuments(filter?: Record<string, unknown>): Promise<number> {
    const gtDate = (filter?.downloadedAt as { $gt?: Date } | undefined)?.$gt;
    if (gtDate) {
      let count = 0;
      for (const doc of this.docs.values()) {
        if (doc.downloadedAt > gtDate) {
          count += 1;
        }
      }
      return Promise.resolve(count);
    }
    return Promise.resolve(this.docs.size);
  }

  private applySingleUpsertOp(op: MapListingBulkOperation): Error | null {
    const id = op.updateOne.filter.listingId;
    const lteDate = (op.updateOne.filter.$or?.[0] as { downloadedAt?: { $lte?: Date } } | undefined)
      ?.downloadedAt?.$lte;
    const existing = this.docs.get(id);
    if (existing && lteDate && existing.downloadedAt > lteDate) {
      return Object.assign(
        new Error(`E11000 duplicate key error collection: webjamsalem.mapListing index: listingId_1 (${id})`),
        { code: 11000 },
      );
    }
    const merged: MapListingRecord = existing
      ? { ...existing, ...op.updateOne.update.$set }
      : { ...op.updateOne.update.$set };
    if (op.updateOne.update.$unset) {
      for (const key of Object.keys(op.updateOne.update.$unset)) {
        delete (merged as unknown as Record<string, unknown>)[key];
      }
    }
    this.docs.set(id, merged);
    return null;
  }

  async bulkWrite(ops: MapListingBulkOperation[]): Promise<unknown> {
    if (this.onBeforeBulkWrite) {
      await this.onBeforeBulkWrite(ops);
    }
    this.bulkWriteCalls.push(ops);
    let dupError: Error | null = null;
    for (const op of ops) {
      const err = this.applySingleUpsertOp(op);
      if (err) {
        dupError = err;
      }
    }
    if (dupError) {
      throw dupError;
    }
    if (this.onAfterBulkWrite) {
      await this.onAfterBulkWrite(ops);
    }
    return { ok: 1 };
  }

  private deleteDocsByFilter(filter: Record<string, unknown>): number {
    if (filter.downloadedAt instanceof Date) {
      let deletedCount = 0;
      for (const [id, doc] of this.docs.entries()) {
        if (doc.downloadedAt.getTime() !== filter.downloadedAt.getTime()) continue;
        this.docs.delete(id);
        deletedCount += 1;
      }
      return deletedCount;
    }
    const ninSpec = filter.listingId as { $nin?: string[] } | undefined;
    const kept = new Set(ninSpec?.$nin);
    const orClauses = filter.$or as Array<{ downloadedAt?: { $lte?: Date } }> | undefined;
    const maxDownloadedAt = orClauses?.[0]?.downloadedAt?.$lte;
    let deletedCount = 0;
    for (const [id, doc] of this.docs.entries()) {
      const withinCutoff = !maxDownloadedAt || doc.downloadedAt <= maxDownloadedAt;
      if (kept.has(id) || !withinCutoff) continue;
      this.docs.delete(id);
      deletedCount += 1;
    }
    return deletedCount;
  }

  async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }> {
    if (filter.listingId === MAP_LISTING_LOCK_ID) {
      const canDeleteLock = Boolean(
        this.lockDoc
        && this.lockDoc.lockOwner === filter.lockOwner
        && (typeof filter.lockEpoch !== 'number' || this.lockDoc.lockEpoch === filter.lockEpoch),
      );
      if (canDeleteLock) {
        this.lockDoc = null;
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    }
    if (this.onBeforeDeleteMany) {
      await this.onBeforeDeleteMany(filter);
    }
    this.deleteManyCalls.push(filter);
    const deletedCount = this.deleteDocsByFilter(filter);
    if (this.onAfterDeleteMany) {
      await this.onAfterDeleteMany(filter);
    }
    return { deletedCount };
  }

  createModelHandle(): MapListingModelLike {
    return {
      findOneAndUpdate: (filter, update, options) => this.findOneAndUpdate(filter, update, options),
      countDocuments: (filter) => this.countDocuments(filter),
      bulkWrite: (ops) => this.bulkWrite(ops),
      deleteMany: (filter) => this.deleteMany(filter),
    };
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
    expect(store.lockDoc?.lockOwner).toBeNull();
    expect(store.lockDoc?.lockExpiresAt).toEqual(new Date(0));
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
    expect(store.lockDoc?.lockOwner).toBeNull();
    expect(store.lockDoc?.lockExpiresAt).toEqual(new Date(0));
  });

  it('reclaims an expired refresh lock and propagates non-duplicate lock errors', async () => {
    const store = new InMemoryMapListingStore([sampleStoredRecord({ listingId: 'ov-1' })]);
    store.lockDoc = {
      listingId: MAP_LISTING_LOCK_ID,
      lockOwner: 'crashed-writer',
      lockEpoch: 1,
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
    expect(store.lockDoc?.lockOwner).toBeNull();
    expect(store.lockDoc?.lockExpiresAt).toEqual(new Date(0));

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

  it('prevents an expired lock owner from pruning or overwriting after another writer reclaims the lease', async () => {
    const store = new InMemoryMapListingStore([]);
    let currentClockMs = SAMPLE_DOWNLOADED_AT.getTime();
    const now = () => new Date(currentClockMs);

    let notifyWriterAPausedAfterUpsert: () => void = () => undefined;
    const writerAPausedAfterUpsert = new Promise<void>((resolve) => {
      notifyWriterAPausedAfterUpsert = resolve;
    });
    let resumeWriterA: () => void = () => undefined;
    const writerACanResume = new Promise<void>((resolve) => {
      resumeWriterA = resolve;
    });

    // Pause Writer A right after it finishes upserting {A, B}, before its prune step:
    store.onAfterBulkWrite = async () => {
      store.onAfterBulkWrite = undefined;
      notifyWriterAPausedAfterUpsert();
      await writerACanResume;
    };

    const writerAPromise = refreshMapListings({
      model: store,
      ownerId: 'writer-A',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Venue B' }),
        ],
      }),
    });

    await writerAPausedAfterUpsert;
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-A', 'ov-B']);

    // Advance clock past the default 30-minute lease (1,800,000 ms):
    currentClockMs += 1_800_000 + 1000;

    // Writer B acquires the expired lock, upserts {B, C}, and prunes {A}:
    const writerBResult = await refreshMapListings({
      model: store,
      ownerId: 'writer-B',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Venue B Updated' }),
          sampleRow({ listingId: 'ov-C', name: 'Venue C' }),
        ],
      }),
    });
    expect(writerBResult).toMatchObject({ written: 2, removed: 1 });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);

    // Resume Writer A; it must fail closed on lost/expired lock ownership and leave {B, C} intact:
    resumeWriterA();
    await expect(writerAPromise).rejects.toThrow(/refresh lock expired or ownership was lost/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.docs.get('ov-B')?.name).toBe('Venue B Updated');
  });

  it('fences in-flight deleteMany and bulkWrite calls by downloadedAt when a writer stalls mid-operation past lease expiry', async () => {
    const store = new InMemoryMapListingStore([]);
    let currentClockMs = SAMPLE_DOWNLOADED_AT.getTime();
    const now = () => new Date(currentClockMs);

    // Case 1: Writer A stalls right inside deleteMany (after the pre-deleteMany lock check)
    let notifyStalledInDelete: () => void = () => undefined;
    const stalledInDelete = new Promise<void>((resolve) => {
      notifyStalledInDelete = resolve;
    });
    let resumeDelete: () => void = () => undefined;
    const canFinishDelete = new Promise<void>((resolve) => {
      resumeDelete = resolve;
    });

    store.onBeforeDeleteMany = async () => {
      store.onBeforeDeleteMany = undefined;
      notifyStalledInDelete();
      await canFinishDelete;
    };

    const writerAPromise = refreshMapListings({
      model: store,
      ownerId: 'writer-A',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Venue B' }),
        ],
      }),
    });

    await stalledInDelete;
    currentClockMs += 1_800_000 + 1000;

    const writerBResult = await refreshMapListings({
      model: store,
      ownerId: 'writer-B',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Venue B From B' }),
          sampleRow({ listingId: 'ov-C', name: 'Venue C From B' }),
        ],
      }),
    });
    expect(writerBResult).toMatchObject({ written: 2, removed: 1 });

    // Resume Writer A's in-flight deleteMany: downloadedAt filter prevents deleting C, and post-check rejects A
    resumeDelete();
    await expect(writerAPromise).rejects.toThrow(/refresh lock expired or ownership was lost/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);

    // Case 2: Writer A stalls right inside bulkWrite (after the pre-bulkWrite lock check)
    let notifyStalledInBulkWrite: () => void = () => undefined;
    const stalledInBulkWrite = new Promise<void>((resolve) => {
      notifyStalledInBulkWrite = resolve;
    });
    let resumeBulkWrite: () => void = () => undefined;
    const canFinishBulkWrite = new Promise<void>((resolve) => {
      resumeBulkWrite = resolve;
    });

    store.onBeforeBulkWrite = async () => {
      store.onBeforeBulkWrite = undefined;
      notifyStalledInBulkWrite();
      await canFinishBulkWrite;
    };

    const writerCPromise = refreshMapListings({
      model: store,
      ownerId: 'writer-C',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Stale Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Stale Venue B' }),
        ],
      }),
    });

    await stalledInBulkWrite;
    currentClockMs += 1_800_000 + 1000;

    await refreshMapListings({
      model: store,
      ownerId: 'writer-D',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Fresh Venue B' }),
          sampleRow({ listingId: 'ov-C', name: 'Fresh Venue C' }),
        ],
      }),
    });

    resumeBulkWrite();
    await expect(writerCPromise).rejects.toThrow(/E11000|duplicate key/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.docs.get('ov-B')?.name).toBe('Fresh Venue B');

    // Case 3: Ownership replacement without advancing the clock (frozen clock) while Writer E is paused after batch 1
    let notifyBatch1Done: () => void = () => undefined;
    const batch1Done = new Promise<void>((resolve) => {
      notifyBatch1Done = resolve;
    });
    let resumeAfterBatch1: () => void = () => undefined;
    const canResumeAfterBatch1 = new Promise<void>((resolve) => {
      resumeAfterBatch1 = resolve;
    });

    store.onAfterBulkWrite = async () => {
      store.onAfterBulkWrite = undefined;
      notifyBatch1Done();
      await canResumeAfterBatch1;
    };

    const writerEPromise = refreshMapListings({
      model: store,
      ownerId: 'writer-E',
      batchSize: 1,
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Replaced A' }),
          sampleRow({ listingId: 'ov-B', name: 'Replaced B' }),
        ],
      }),
    });

    await batch1Done;
    // Force lock expiration in-place without advancing `currentClockMs` to simulate direct ownership replacement:
    if (store.lockDoc) {
      store.lockDoc.lockExpiresAt = new Date(currentClockMs - 1);
    }

    await refreshMapListings({
      model: store,
      ownerId: 'writer-F',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Owner F Venue B' }),
          sampleRow({ listingId: 'ov-C', name: 'Owner F Venue C' }),
        ],
      }),
    });

    resumeAfterBatch1();
    await expect(writerEPromise).rejects.toThrow(/refresh lock expired or ownership was lost/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.docs.get('ov-B')?.name).toBe('Owner F Venue B');
  });

  it('preserves existing valid rows when a replacement writer fails midway through its batches while the expired owner resumes', async () => {
    const store = new InMemoryMapListingStore([]);
    let currentClockMs = SAMPLE_DOWNLOADED_AT.getTime();
    const now = () => new Date(currentClockMs);

    const fourRows = [
      sampleRow({ listingId: 'ov-A', name: 'Venue A' }),
      sampleRow({ listingId: 'ov-B', name: 'Venue B' }),
      sampleRow({ listingId: 'ov-C', name: 'Venue C' }),
      sampleRow({ listingId: 'ov-D', name: 'Venue D' }),
    ];

    // Load initial snapshot {A, B, C, D}:
    await refreshMapListings({
      model: store,
      ownerId: 'initial-loader',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: fourRows,
      }),
    });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-A', 'ov-B', 'ov-C', 'ov-D']);

    currentClockMs += 60_000;

    let notifyWriterAPaused: () => void = () => undefined;
    const writerAPaused = new Promise<void>((resolve) => {
      notifyWriterAPaused = resolve;
    });
    let resumeWriterA: () => void = () => undefined;
    const writerACanResume = new Promise<void>((resolve) => {
      resumeWriterA = resolve;
    });

    // Writer A rewrites {A, B, C, D} and pauses after its batch:
    store.onAfterBulkWrite = async () => {
      store.onAfterBulkWrite = undefined;
      notifyWriterAPaused();
      await writerACanResume;
    };

    const writerAPromise = refreshMapListings({
      model: store,
      ownerId: 'writer-A',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: fourRows,
      }),
    });

    await writerAPaused;

    // Advance past the default 30-minute lease:
    currentClockMs += 1_800_000 + 1000;

    // Writer B downloads {B, C}, passes the half-size guard, writes B with batchSize: 1,
    // and encounters a database failure before writing C:
    let writerBBatchCount = 0;
    store.onBeforeBulkWrite = async () => {
      writerBBatchCount += 1;
      if (writerBBatchCount === 2) {
        store.onBeforeBulkWrite = undefined;
        throw new Error('Database failure before batch 2');
      }
    };

    await expect(
      refreshMapListings({
        model: store,
        ownerId: 'writer-B',
        batchSize: 1,
        now,
        fetchAnswer: () => Promise.resolve({
          release: SAMPLE_RELEASE,
          rows: [
            sampleRow({ listingId: 'ov-B', name: 'Venue B Partial' }),
            sampleRow({ listingId: 'ov-C', name: 'Venue C Partial' }),
          ],
        }),
      }),
    ).rejects.toThrow('Database failure before batch 2');

    // Resume Writer A; because Writer B failed midway and never committed a replacement copy,
    // Writer A's catch path must NOT delete {A, C, D}:
    resumeWriterA();
    await expect(writerAPromise).rejects.toThrow(/refresh lock expired or ownership was lost/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-A', 'ov-B', 'ov-C', 'ov-D']);
  });

  it('coordinates committed-refresh rollback and partial-failure preservation across isolated module and model instances', async () => {
    vi.resetModules();
    const isolatedModule = await import('#src/model/venue/map-listing-refresh.js');

    const store = new InMemoryMapListingStore([]);
    const modelA = store.createModelHandle();
    const modelB = store.createModelHandle();

    let currentClockMs = SAMPLE_DOWNLOADED_AT.getTime();
    const now = () => new Date(currentClockMs);

    let notifyWriterAStalledInBulkWrite: () => void = () => undefined;
    const writerAStalledInBulkWrite = new Promise<void>((resolve) => {
      notifyWriterAStalledInBulkWrite = resolve;
    });
    let resumeWriterABulkWrite: () => void = () => undefined;
    const writerACanFinishBulkWrite = new Promise<void>((resolve) => {
      resumeWriterABulkWrite = resolve;
    });

    // Pause Writer A (module instance 1, model handle A) inside bulkWrite for {A, B}:
    store.onBeforeBulkWrite = async () => {
      store.onBeforeBulkWrite = undefined;
      notifyWriterAStalledInBulkWrite();
      await writerACanFinishBulkWrite;
    };

    const writerAPromise = refreshMapListings({
      model: modelA,
      ownerId: 'process-A',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Process A Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Process A Venue B' }),
        ],
      }),
    });

    await writerAStalledInBulkWrite;
    // Expire Writer A's default 30-minute lease:
    currentClockMs += 1_800_000 + 1000;

    // Writer B runs in an independently loaded module instance with its own model handle,
    // successfully loading and pruning {B, C}:
    const writerBResult = await isolatedModule.refreshMapListings({
      model: modelB,
      ownerId: 'process-B',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Process B Venue B' }),
          sampleRow({ listingId: 'ov-C', name: 'Process B Venue C' }),
        ],
      }),
    });
    expect(writerBResult).toMatchObject({ written: 2 });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);

    // Resume Writer A: its unordered batch inserts A and hits the fenced duplicate-key error on B;
    // cleanup reads durable lastCommittedAt from the shared store and removes A, leaving {B, C}:
    resumeWriterABulkWrite();
    await expect(writerAPromise).rejects.toThrow(/E11000|duplicate key/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.docs.get('ov-B')?.name).toBe('Process B Venue B');
  });

  it('cleans up stale reinsertions when an expired writer finishes during the replacement prune-to-commit window', async () => {
    vi.resetModules();
    const isolatedModule = await import('#src/model/venue/map-listing-refresh.js');

    const store = new InMemoryMapListingStore([]);
    const modelA = store.createModelHandle();
    const modelB = store.createModelHandle();

    let currentClockMs = SAMPLE_DOWNLOADED_AT.getTime();
    const now = () => new Date(currentClockMs);

    // 1. Start from a loaded {A, B}:
    await refreshMapListings({
      model: modelA,
      ownerId: 'initial-loader',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Initial Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Initial Venue B' }),
        ],
      }),
    });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-A', 'ov-B']);
    const initialCommittedAt = store.lockDoc?.lastCommittedAt;
    expect(initialCommittedAt).toBeInstanceOf(Date);

    currentClockMs += 60_000;

    // 2. Pause Writer A inside bulkWrite for {A, B}:
    let notifyWriterAPausedInBulkWrite: () => void = () => undefined;
    const writerAPausedInBulkWrite = new Promise<void>((resolve) => {
      notifyWriterAPausedInBulkWrite = resolve;
    });
    let resumeWriterABulkWrite: () => void = () => undefined;
    const writerACanFinishBulkWrite = new Promise<void>((resolve) => {
      resumeWriterABulkWrite = resolve;
    });

    store.onBeforeBulkWrite = async () => {
      store.onBeforeBulkWrite = undefined;
      notifyWriterAPausedInBulkWrite();
      await writerACanFinishBulkWrite;
    };

    const writerAPromise = refreshMapListings({
      model: modelA,
      ownerId: 'writer-A',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-A', name: 'Stale Writer A Venue A' }),
          sampleRow({ listingId: 'ov-B', name: 'Stale Writer A Venue B' }),
        ],
      }),
    });

    await writerAPausedInBulkWrite;

    // 3. Expire Writer A's default 30-minute lease:
    currentClockMs += 1_800_000 + 1000;

    // 4. Let Writer B write {B, C} and finish pruning A, then pause B before its final commit-marker update:
    let notifyWriterBPausedAfterPrune: () => void = () => undefined;
    const writerBPausedAfterPrune = new Promise<void>((resolve) => {
      notifyWriterBPausedAfterPrune = resolve;
    });
    let resumeWriterBAfterPrune: () => void = () => undefined;
    const writerBCanFinishCommit = new Promise<void>((resolve) => {
      resumeWriterBAfterPrune = resolve;
    });

    store.onAfterDeleteMany = async () => {
      store.onAfterDeleteMany = undefined;
      notifyWriterBPausedAfterPrune();
      await writerBCanFinishCommit;
    };

    const writerBPromise = isolatedModule.refreshMapListings({
      model: modelB,
      ownerId: 'writer-B',
      now,
      fetchAnswer: () => Promise.resolve({
        release: SAMPLE_RELEASE,
        rows: [
          sampleRow({ listingId: 'ov-B', name: 'Replacement Venue B' }),
          sampleRow({ listingId: 'ov-C', name: 'Replacement Venue C' }),
        ],
      }),
    });

    await writerBPausedAfterPrune;
    // Verify B has finished pruning A, but has NOT yet updated lastCommittedAt past initialCommittedAt:
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.lockDoc?.lastCommittedAt).toEqual(initialCommittedAt);
    expect(store.lockDoc?.lastPruningAt?.getTime()).toBeGreaterThan(initialCommittedAt!.getTime());

    // 5. Resume Writer A during B's prune-to-commit window: its unordered batch reinserts A and gets
    // E11000 on B, and cleanup sees lastPruningAt > A's downloadedAt and removes A:
    resumeWriterABulkWrite();
    await expect(writerAPromise).rejects.toThrow(/E11000|duplicate key/);
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);

    // 6. Resume Writer B: it records its commit and returns { written: 2, removed: 1 }, with final collection {B, C}:
    resumeWriterBAfterPrune();
    const writerBResult = await writerBPromise;
    expect(writerBResult).toMatchObject({ written: 2, removed: 1 });
    expect(store.snapshot().map((d) => d.listingId)).toEqual(['ov-B', 'ov-C']);
    expect(store.docs.get('ov-B')?.name).toBe('Replacement Venue B');
    expect(store.docs.get('ov-C')?.name).toBe('Replacement Venue C');
  });
});

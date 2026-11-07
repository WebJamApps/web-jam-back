import fs from 'node:fs';
import mongoose from 'mongoose';
import {
  isSafeToRun,
  parseMongoUri,
  parseCliArgs,
  normalizeTitle,
  toDisplayTitle,
  parseWriterCell,
  parseBmiWorksMarkdown,
  validateBmiWorks,
  validateCdBabyReleases,
  validateArchiveSongs,
  isRecordingMatch,
  enrichRecording,
  mergeRecordingsList,
  assembleCatalog,
  executeCatalogSync,
  resolveSources,
  run,
  type CatalogStore,
  type SongCatalogDoc,
  type SongRecording,
} from '#src/scripts/load-song-catalog.js';

describe('load-song-catalog script (#1228)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSafeToRun database guard and parseMongoUri (#1228 review P1)', () => {
    it('refuses empty uri', () => {
      expect(isSafeToRun('', false)).toBe(false);
      expect(isSafeToRun('', true)).toBe(false);
    });

    it('refuses malformed or non-mongodb URIs', () => {
      expect(parseMongoUri('not-a-mongo-uri')).toBeNull();
      expect(isSafeToRun('not-a-mongo-uri', false)).toBe(false);
    });

    it('refuses remote hostnames that merely contain "localhost" as a substring', () => {
      const misleadingHost = 'mongodb://localhost.remote.invalid/release';
      expect(isSafeToRun(misleadingHost, false)).toBe(false);
    });

    it('refuses remote database names that merely contain "test", "dev", or "copy" as a substring', () => {
      expect(isSafeToRun('mongodb://remote.invalid/contest', false)).toBe(false);
      expect(isSafeToRun('mongodb://remote.invalid/prodev', false)).toBe(false);
      expect(isSafeToRun('mongodb://remote.invalid/copycat', false)).toBe(false);
      expect(isSafeToRun('mongodb+srv://cluster.example.invalid/production', false)).toBe(false);
      expect(isSafeToRun('mongodb+srv://cluster.example.invalid/release', false)).toBe(false);
    });

    it('refuses mixed local and remote hosts without --force', () => {
      const mixedUri = 'mongodb://localhost:27017,remote.invalid:27017/release';
      expect(isSafeToRun(mixedUri, false)).toBe(false);
    });

    it('allows localhost and loopback hostnames without --force', () => {
      const localUri = ['mongodb:', '//localhost:27017/any-db'].join('');
      const loopbackUri = ['mongodb:', '//127.0.0.1:27017/any-db'].join('');
      expect(isSafeToRun(localUri, false)).toBe(true);
      expect(isSafeToRun(loopbackUri, false)).toBe(true);
    });

    it('allows deliberate dev, test, and copy database name conventions without --force', () => {
      const devUri = ['mongodb', '+srv:', '//cluster.example.invalid/web-jam-dev'].join('');
      const testUri = ['mongodb', '+srv:', '//cluster.example.invalid/web-jam-test'].join('');
      const copyUri = ['mongodb:', '//remote.example.invalid/song-catalog-copy'].join('');
      const underDevUri = ['mongodb:', '//remote.example.invalid/my_db_dev'].join('');
      expect(isSafeToRun(devUri, false)).toBe(true);
      expect(isSafeToRun(testUri, false)).toBe(true);
      expect(isSafeToRun(copyUri, false)).toBe(true);
      expect(isSafeToRun(underDevUri, false)).toBe(true);
    });

    it('allows any database when --force is passed', () => {
      const releaseUri = ['mongodb', '+srv:', '//dummy.example.invalid/release'].join('');
      expect(isSafeToRun(releaseUri, true)).toBe(true);
    });
  });

  describe('parseCliArgs', () => {
    it('defaults apply and force to false', () => {
      expect(parseCliArgs([])).toEqual({ apply: false, force: false });
    });

    it('parses flags and file path arguments', () => {
      const opts = parseCliArgs([
        '--apply',
        '--force',
        '--bmi-file',
        'fixtures/test-bmi.md',
        '--cdbaby-file',
        'fixtures/test-cdbaby.json',
        '--archive-file',
        'fixtures/test-archive.json',
      ]);
      expect(opts).toEqual({
        apply: true,
        force: true,
        bmiFile: 'fixtures/test-bmi.md',
        cdBabyFile: 'fixtures/test-cdbaby.json',
        archiveFile: 'fixtures/test-archive.json',
      });
    });
  });

  describe('normalizeTitle and toDisplayTitle', () => {
    it('normalizes titles for comparison ignoring punctuation, whitespace, and case', () => {
      expect(normalizeTitle("Don't Let Me Down")).toBe('dontletmedown');
      expect(normalizeTitle('Somebody’s Fool!')).toBe('somebodysfool');
    });

    it('formats titles into Title Case and restores contractions', () => {
      expect(toDisplayTitle('all my life')).toBe('All My Life');
      expect(toDisplayTitle('somebody s fool')).toBe("Somebody's Fool");
      expect(toDisplayTitle('don t stop')).toBe("Don't Stop");
      expect(toDisplayTitle('mr fate')).toBe('Mr. Fate');
    });
  });

  describe('BMI works parsing and rights provenance (#1228 review P1)', () => {
    it('preserves unknown writers when BMI table provides no writer/share columns (NO manufactured 100% share)', () => {
      const markdown = `
# BMI Account Overview
Writer Account: Sherman Joshua Victor 798301
IPI: 00358258629

| Title | BMI work number | Alternate titles |
|---|---|---|
| ALL MY LIFE | 5530339 | |
| BREAK OUT | 5530317 | |
`;
      const works = parseBmiWorksMarkdown(markdown);
      expect(works).toHaveLength(2);
      expect(works[0]).toEqual({
        title: 'All My Life',
        bmiWorkNumber: '5530339',
        writers: [], // Unverified details preserved as unknown
      });
      expect(works[1]).toEqual({
        title: 'Break Out',
        bmiWorkNumber: '5530317',
        writers: [],
      });
    });

    it('parses verified co-written works with explicit shares and inline shares', () => {
      const markdown = `
| Title | BMI work number | Writers | Shares |
|---|---|---|---|
| CO-WRITTEN WORK | 990001 | Alice Songwriter, Bob CoWriter | 50%, 50% |
| INLINE SHARE WORK | 990002 | Carol Author (70%), Dave Contributor (30%) | |
| SINGLE WRITER FULL | 990003 | Eve Soloist | 100% |
`;
      const works = parseBmiWorksMarkdown(markdown);
      expect(works).toHaveLength(3);
      expect(works[0].writers).toEqual([
        { name: 'Alice Songwriter', share: 50 },
        { name: 'Bob CoWriter', share: 50 },
      ]);
      expect(works[1].writers).toEqual([
        { name: 'Carol Author', share: 70 },
        { name: 'Dave Contributor', share: 30 },
      ]);
      expect(works[2].writers).toEqual([
        { name: 'Eve Soloist', share: 100 },
      ]);
    });

    it('parses co-written works and single writers with missing shares leaving share undefined', () => {
      const markdown = `
| Title | BMI work number | Writers |
|---|---|---|
| MISSING SHARE CO-WRITE | 990004 | Frank Lyricist, Grace Composer |
| MISSING SHARE SOLO | 990005 | Heidi Melody |
`;
      const works = parseBmiWorksMarkdown(markdown);
      expect(works).toHaveLength(2);
      expect(works[0].writers).toEqual([
        { name: 'Frank Lyricist' },
        { name: 'Grace Composer' },
      ]);
      expect(works[0].writers[0].share).toBeUndefined();
      expect(works[0].writers[1].share).toBeUndefined();
      expect(works[1].writers).toEqual([
        { name: 'Heidi Melody' },
      ]);
      expect(works[1].writers[0].share).toBeUndefined();
    });

    it('parseWriterCell handles empty text, semicolons, and various share formats', () => {
      expect(parseWriterCell('')).toEqual([]);
      expect(parseWriterCell('Sherman, Joshua; Doe, Jane', '60; 40')).toEqual([
        { name: 'Sherman, Joshua', share: 60 },
        { name: 'Doe, Jane', share: 40 },
      ]);
    });
  });

  describe('source validation and refusal (#1228 review P2)', () => {
    it('refuses missing BMI source file', () => {
      expect(() => resolveSources({
        apply: false,
        force: false,
        bmiFile: 'fixtures/nonexistent-bmi.md',
      })).toThrow('missing required BMI works source file');
    });

    it('refuses empty BMI source file', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('');
      expect(() => resolveSources({
        apply: false,
        force: false,
        bmiFile: 'fixtures/empty-bmi.md',
      })).toThrow('BMI works source file "fixtures/empty-bmi.md" is empty');
    });

    it('refuses BMI file with no recognized works table', () => {
      expect(() => validateBmiWorks([], 'fixtures/no-works.md')).toThrow('contains no recognized works');
    });

    it('refuses missing CD Baby releases file', () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p).includes('bmi'));
      vi.spyOn(fs, 'readFileSync').mockReturnValue('| Title | BMI work number |\n| Song | 123 |');
      expect(() => resolveSources({
        apply: false,
        force: false,
        cdBabyFile: 'fixtures/nonexistent-cdbaby.json',
      })).toThrow('missing required CD Baby releases source file');
    });

    it('refuses empty or malformed CD Baby releases file', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        if (String(p).includes('bmi')) return '| Title | BMI work number |\n| Song | 123 |';
        return 'not-json';
      });
      expect(() => resolveSources({
        apply: false,
        force: false,
        cdBabyFile: 'fixtures/malformed-cdbaby.json',
      })).toThrow('is not valid JSON');
    });

    it('refuses invalid CD Baby release shape', () => {
      expect(() => validateCdBabyReleases([{ invalid: true }], 'fixtures/bad-shape.json'))
        .toThrow('contains unrecognized release shape');
      expect(() => validateCdBabyReleases([{ release: 'R', artist: 'A', tracks: [] }], 'fixtures/bad.json'))
        .toThrow('contains unrecognized release shape');
      expect(() => validateCdBabyReleases([{ release: 'R', artist: 'A', tracks: [{ noTitle: true }] }], 'fixtures/bad.json'))
        .toThrow('contains track with missing title');
    });

    it('refuses missing, empty, or malformed music archive file', () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((p) => !String(p).includes('archive'));
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        if (String(p).includes('bmi')) return '| Title | BMI work number |\n| Song | 123 |';
        return JSON.stringify([{ release: 'R', artist: 'A', tracks: [{ title: 'S' }] }]);
      });
      expect(() => resolveSources({
        apply: false,
        force: false,
        archiveFile: 'fixtures/nonexistent-archive.json',
      })).toThrow('missing required music archive source file');

      expect(() => validateArchiveSongs([], 'fixtures/bad.json')).toThrow('contains invalid or empty song records');
      expect(() => validateArchiveSongs([{ title: 'T', artist: 'A', category: 'invalid-cat' }], 'fixtures/bad.json'))
        .toThrow('contains unrecognized song shape');
    });

    it('resolves and parses all sources cleanly when valid fixtures are provided', () => {
      const bmiFixture = '| Title | BMI work number |\n| Break Out | 5530317 |\n';
      const cdBabyFixture = JSON.stringify([
        {
          release: 'Solo Acoustic',
          artist: 'Josh Sherman',
          tracks: [{ title: 'Break Out', isrc: 'TEST-ISRC-01' }],
        },
      ]);
      const archiveFixture = JSON.stringify([
        {
          title: 'Break Out',
          artist: 'Josh Sherman',
          category: 'original',
          album: 'Solo Acoustic',
          url: 'https://example.invalid/song.mp3',
        },
      ]);

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.includes('bmi')) return bmiFixture;
        if (pathStr.includes('cdbaby')) return cdBabyFixture;
        return archiveFixture;
      });

      const sources = resolveSources({
        apply: false,
        force: false,
        bmiFile: 'fixtures/bmi.md',
        cdBabyFile: 'fixtures/cdbaby.json',
        archiveFile: 'fixtures/archive.json',
      });

      expect(sources.bmiWorks).toHaveLength(1);
      expect(sources.cdBabyReleases).toHaveLength(1);
      expect(sources.archiveSongs).toHaveLength(1);
    });
  });

  describe('recording enrichment and conflict detection (#1228 review P2)', () => {
    it('isRecordingMatch matches by ISRC, URL, or release + artist', () => {
      expect(isRecordingMatch({ isrc: 'US-123' }, { isrc: 'us-123' })).toBe(true);
      expect(isRecordingMatch({ url: 'https://a.com/1' }, { url: 'https://a.com/1' })).toBe(true);
      expect(isRecordingMatch(
        { release: 'Solo Acoustic', artist: 'Josh Sherman' },
        { release: 'solo acoustic', artist: 'josh sherman' },
      )).toBe(true);
      expect(isRecordingMatch(
        { release: 'Album A', artist: 'Artist A' },
        { release: 'Album B', artist: 'Artist A' },
      )).toBe(false);
    });

    it('enriches matching recording with missing fields (e.g. attaching archive URL to CD Baby release)', () => {
      const cdBabyRec: SongRecording = {
        release: 'Solo Acoustic',
        artist: 'Josh Sherman',
        isrc: 'TEST-ISRC-01',
        year: 2001,
      };
      const archiveRec: SongRecording = {
        release: 'Solo Acoustic',
        artist: 'Josh Sherman',
        url: 'https://example.invalid/break-out.mp3',
        year: 2001,
      };

      const result = enrichRecording(cdBabyRec, archiveRec);
      expect(result.modified).toBe(true);
      expect(cdBabyRec.url).toBe('https://example.invalid/break-out.mp3');
      expect(cdBabyRec.isrc).toBe('TEST-ISRC-01');
    });

    it('detects conflicting ISRC, URL, or release and reports conflict', () => {
      const rec1: SongRecording = {
        release: 'Solo Acoustic',
        artist: 'Josh Sherman',
        isrc: 'TEST-ISRC-01',
      };
      const rec2: SongRecording = {
        release: 'Solo Acoustic',
        artist: 'Josh Sherman',
        isrc: 'TEST-ISRC-02',
      };

      const result = enrichRecording(rec1, rec2);
      expect(result.modified).toBe(false);
      expect(result.conflict).toContain('Conflicting ISRC');
    });

    it('mergeRecordingsList enriches existing database recording when incoming source provides ISRC', () => {
      const existingInDb: SongRecording[] = [
        { release: 'Solo Acoustic', artist: 'Josh Sherman', url: 'https://example.invalid/song.mp3' },
      ];
      const incomingFromSource: SongRecording[] = [
        { release: 'Solo Acoustic', artist: 'Josh Sherman', isrc: 'TEST-ISRC-99' },
      ];

      const merged = mergeRecordingsList(existingInDb, incomingFromSource, 'Break Out');
      expect(merged).not.toBeNull();
      expect(merged).toHaveLength(1);
      expect(merged![0].isrc).toBe('TEST-ISRC-99');
      expect(merged![0].url).toBe('https://example.invalid/song.mp3');
    });

    it('mergeRecordingsList throws error when conflicting identifiers are detected', () => {
      const existingInDb: SongRecording[] = [
        { release: 'Solo Acoustic', artist: 'Josh Sherman', isrc: 'ISRC-AAA' },
      ];
      const incoming: SongRecording[] = [
        { release: 'Solo Acoustic', artist: 'Josh Sherman', isrc: 'ISRC-BBB' },
      ];

      expect(() => mergeRecordingsList(existingInDb, incoming, 'Conflicted Song'))
        .toThrow('Cannot merge recordings for song "Conflicted Song": Conflicting ISRC');
    });
  });

  describe('assembleCatalog', () => {
    it('enriches CD Baby recording with archive audio URL on initial catalog assembly', () => {
      const catalog = assembleCatalog({
        bmiWorks: [
          {
            title: 'Break Out',
            bmiWorkNumber: 'TEST-BMI-01',
            writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
          },
        ],
        cdBabyReleases: [
          {
            release: 'Solo Acoustic',
            artist: 'Josh Sherman',
            year: 2001,
            tracks: [{ title: 'Break Out', isrc: 'TEST-ISRC-01' }],
          },
        ],
        archiveSongs: [
          {
            title: 'Break Out',
            artist: 'Josh Sherman',
            category: 'original',
            album: 'Solo Acoustic',
            url: 'https://example.invalid/break-out.mp3',
            year: 2001,
          },
        ],
      });

      expect(catalog).toHaveLength(1);
      const song = catalog[0];
      expect(song.title).toBe('Break Out');
      expect(song.bmiWorkNumber).toBe('TEST-BMI-01');
      expect(song.writers).toEqual([{ name: 'Joshua Victor Sherman', share: 100 }]);
      expect(song.url).toBe('https://example.invalid/break-out.mp3');
      expect(song.recordings).toHaveLength(1);
      expect(song.recordings[0]).toEqual({
        release: 'Solo Acoustic',
        artist: 'Josh Sherman',
        isrc: 'TEST-ISRC-01',
        url: 'https://example.invalid/break-out.mp3',
        year: 2001,
      });
    });

    it('INVARIANT: website artist or CD Baby performer is NEVER added to writers', () => {
      const catalog = assembleCatalog({
        cdBabyReleases: [
          {
            release: 'Band Live',
            artist: 'The Test Duo Band',
            year: 2005,
            tracks: [{ title: 'Unrecorded Band Jam' }],
          },
        ],
        archiveSongs: [
          {
            title: 'Cover Song',
            artist: 'Famous Cover Band',
            composer: 'Famous Original Artist',
            category: 'pub',
            url: 'https://example.invalid/cover.mp3',
          },
        ],
      });

      expect(catalog).toHaveLength(2);
      for (const song of catalog) {
        expect(song.writers).toEqual([]);
      }
    });

    it('handles unrecorded BMI works leaving url omitted for sparse index safety', () => {
      const catalog = assembleCatalog({
        bmiWorks: [
          {
            title: 'Unrecorded Original',
            bmiWorkNumber: 'TEST-BMI-99',
            writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
          },
        ],
      });

      expect(catalog).toHaveLength(1);
      const song = catalog[0];
      expect(song.title).toBe('Unrecorded Original');
      expect(song.url).toBeUndefined();
      expect(song.recordings).toEqual([]);
    });
  });

  describe('dry run and idempotent apply sync with outcome verification (#1228 review P2)', () => {
    it('dry run reports planned operations without modifying store, apply persists and verifies counts, re-run is idempotent', async () => {
      const storeData: SongCatalogDoc[] = [
        {
          _id: 'existing-id-1',
          title: 'Existing Song',
          artist: 'Josh Sherman',
          category: 'original',
          writers: [],
          recordings: [{ release: 'Live Vol 1', artist: 'Josh Sherman' }],
        },
      ];

      const catalog: SongCatalogDoc[] = [
        {
          title: 'Existing Song',
          artist: 'Josh Sherman',
          category: 'original',
          bmiWorkNumber: 'TEST-BMI-EX1',
          writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
          recordings: [{ release: 'Live Vol 1', artist: 'Josh Sherman', isrc: 'TEST-ISRC-EX1' }],
        },
        {
          title: 'Brand New Song',
          artist: 'Josh Sherman',
          category: 'original',
          bmiWorkNumber: 'TEST-BMI-NEW',
          writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
          recordings: [],
        },
      ];

      const store: CatalogStore = {
        find: () => ({
          toArray: () => Promise.resolve(structuredClone(storeData) as unknown as Record<string, unknown>[]),
        }),
        findOne: (filter: Record<string, unknown>) => {
          const match = storeData.find((d) => d._id === filter._id);
          return Promise.resolve(match ? (structuredClone(match) as unknown as Record<string, unknown>) : null);
        },
        updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => {
          const match = storeData.find((d) => d._id === filter._id);
          if (match && update.$set) {
            Object.assign(match, update.$set);
            return Promise.resolve({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
          }
          return Promise.resolve({ acknowledged: true, matchedCount: 0, modifiedCount: 0 });
        },
        insertOne: (doc: Record<string, unknown>) => {
          const newDoc = { _id: `id-${storeData.length + 1}`, ...doc } as unknown as SongCatalogDoc;
          storeData.push(newDoc);
          return Promise.resolve({ acknowledged: true, insertedId: newDoc._id });
        },
        countDocuments: () => Promise.resolve(storeData.length),
      };

      const log = vi.fn();

      // 1. Dry run
      const dryResult = await executeCatalogSync(store, catalog, false, log);
      expect(dryResult.plannedInserts).toBe(1);
      expect(dryResult.plannedUpdates).toBe(1);
      expect(dryResult.inserted).toBe(0);
      expect(dryResult.updated).toBe(0);
      expect(storeData).toHaveLength(1);
      expect(storeData[0].bmiWorkNumber).toBeUndefined();

      // 2. Apply run
      const applyResult = await executeCatalogSync(store, catalog, true, log);
      expect(applyResult.inserted).toBe(1);
      expect(applyResult.updated).toBe(1);
      expect(storeData).toHaveLength(2);
      expect(storeData[0].bmiWorkNumber).toBe('TEST-BMI-EX1');
      expect(storeData[0].writers).toEqual([{ name: 'Joshua Victor Sherman', share: 100 }]);
      expect(storeData[0].recordings[0].isrc).toBe('TEST-ISRC-EX1'); // Enriched recording
      expect(storeData[1].title).toBe('Brand New Song');
      expect(storeData[1].url).toBeUndefined(); // Sparse uniqueness

      // 3. Second apply run (idempotent)
      const secondApply = await executeCatalogSync(store, catalog, true, log);
      expect(secondApply.inserted).toBe(0);
      expect(secondApply.updated).toBe(0);
      expect(secondApply.unchanged).toBe(2);
      expect(storeData).toHaveLength(2);
    });

    it('refuses completion when update matches 0 documents (zero-match-update regression)', async () => {
      const store: CatalogStore = {
        find: () => ({
          toArray: () => Promise.resolve([{ _id: 'doc-1', title: 'Song', writers: [] }]),
        }),
        findOne: () => Promise.resolve(null),
        updateOne: () => Promise.resolve({ acknowledged: true, matchedCount: 0, modifiedCount: 0 }),
        insertOne: () => Promise.resolve({ acknowledged: true }),
        countDocuments: () => Promise.resolve(1),
      };

      const catalog: SongCatalogDoc[] = [
        {
          title: 'Song',
          artist: 'Josh Sherman',
          category: 'original',
          writers: [{ name: 'Verified Writer', share: 100 }],
          recordings: [],
        },
      ];

      await expect(executeCatalogSync(store, catalog, true, vi.fn()))
        .rejects.toThrow('update matched 0 documents');
    });

    it('refuses completion when final collection count does not match starting count + planned inserts (count-mismatch regression)', async () => {
      let callCount = 0;
      const store: CatalogStore = {
        find: () => ({ toArray: () => Promise.resolve([]) }),
        findOne: () => Promise.resolve(null),
        updateOne: () => Promise.resolve({ acknowledged: true, matchedCount: 1 }),
        insertOne: () => Promise.resolve({ acknowledged: true, insertedId: '1' }),
        countDocuments: () => {
          callCount += 1;
          // First call: startCount = 0. Second call: finalTotal = 0 (simulating failed insert or unreflected write)
          return Promise.resolve(0);
        },
      };

      const catalog: SongCatalogDoc[] = [
        {
          title: 'New Song',
          artist: 'Josh Sherman',
          category: 'original',
          writers: [],
          recordings: [],
        },
      ];

      await expect(executeCatalogSync(store, catalog, true, vi.fn()))
        .rejects.toThrow('Apply verification mismatch: starting count was 0, planned 1 inserts, expected final count 1, but collection count is 0');
    });

    it('refuses completion when insert is not acknowledged', async () => {
      const store: CatalogStore = {
        find: () => ({ toArray: () => Promise.resolve([]) }),
        findOne: () => Promise.resolve(null),
        updateOne: () => Promise.resolve({ acknowledged: true }),
        insertOne: () => Promise.resolve({ acknowledged: false }),
        countDocuments: () => Promise.resolve(0),
      };

      const catalog: SongCatalogDoc[] = [
        {
          title: 'Unacknowledged Song',
          artist: 'Josh Sherman',
          category: 'original',
          writers: [],
          recordings: [],
        },
      ];

      await expect(executeCatalogSync(store, catalog, true, vi.fn()))
        .rejects.toThrow('insert not acknowledged');
    });
  });

  describe('run() error handling and safe execution', () => {
    it('refuses to run against non-safe target database', async () => {
      const connect = vi.spyOn(mongoose, 'connect');
      const prodUri = ['mongodb', '+srv:', '//prod.example.invalid/release'].join('');
      await expect(run([], prodUri)).rejects.toThrow('Refusing: target database');
      expect(connect).not.toHaveBeenCalled();
    });

    it('disconnects mongoose even when connect fails', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        const pathStr = String(p);
        if (pathStr.includes('bmi')) return '| Title | BMI work number |\n| S | 1 |';
        if (pathStr.includes('cdbaby') || pathStr.includes('cd-baby')) {
          return JSON.stringify([{ release: 'R', artist: 'A', tracks: [{ title: 'S' }] }]);
        }
        return JSON.stringify([{ title: 'S', artist: 'A', category: 'original' }]);
      });
      vi.spyOn(mongoose, 'connect').mockRejectedValue(new Error('Mongo network timeout'));
      const disconnect = vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
      const safeUri = ['mongodb:', '//127.0.0.1:27017/web-jam-test'].join('');

      await expect(run([], safeUri)).rejects.toThrow('Mongo network timeout');
      expect(disconnect).toHaveBeenCalled();
    });
  });
});

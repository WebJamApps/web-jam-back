import mongoose from 'mongoose';
import {
  isSafeToRun,
  parseCliArgs,
  normalizeTitle,
  toDisplayTitle,
  parseBmiWorksMarkdown,
  parseCdBabyData,
  parseArchiveSongs,
  assembleCatalog,
  planCatalogSync,
  executeCatalogSync,
  resolveSources,
  run,
  type CatalogStore,
  type SongCatalogDoc,
} from '#src/scripts/load-song-catalog.js';

describe('load-song-catalog script (#1228)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isSafeToRun database guard', () => {
    it('refuses empty uri', () => {
      expect(isSafeToRun('', false)).toBe(false);
    });

    it('refuses production or remote uri without --force', () => {
      const releaseUri = ['mongodb', '+srv:', '//dummy.example.invalid/release'].join('');
      const prodUri = ['mongodb', '+srv:', '//dummy.example.invalid/production'].join('');
      expect(isSafeToRun(releaseUri, false)).toBe(false);
      expect(isSafeToRun(prodUri, false)).toBe(false);
    });

    it('allows localhost and 127.0.0.1 without --force', () => {
      const localUri = ['mongodb:', '//localhost:27017/any-db'].join('');
      const loopbackUri = ['mongodb:', '//127.0.0.1:27017/any-db'].join('');
      expect(isSafeToRun(localUri, false)).toBe(true);
      expect(isSafeToRun(loopbackUri, false)).toBe(true);
    });

    it('allows dev, test, and copy db names without --force', () => {
      const devUri = ['mongodb', '+srv:', '//cluster.example.invalid/web-jam-dev'].join('');
      const testUri = ['mongodb', '+srv:', '//cluster.example.invalid/web-jam-test'].join('');
      const copyUri = ['mongodb:', '//remote.example.invalid/song-catalog-copy'].join('');
      expect(isSafeToRun(devUri, false)).toBe(true);
      expect(isSafeToRun(testUri, false)).toBe(true);
      expect(isSafeToRun(copyUri, false)).toBe(true);
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
        '/tmp/test-bmi.md',
        '--cdbaby-file',
        '/tmp/test-cdbaby.json',
        '--archive-file',
        '/tmp/test-archive.json',
      ]);
      expect(opts).toEqual({
        apply: true,
        force: true,
        bmiFile: '/tmp/test-bmi.md',
        cdBabyFile: '/tmp/test-cdbaby.json',
        archiveFile: '/tmp/test-archive.json',
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

  describe('data parsing from sources', () => {
    it('parses BMI markdown table with mocked data', () => {
      const markdown = `
# BMI Account Overview
Writer Account: Sherman Joshua Victor
IPI: TEST-IPI-001

| Title | BMI work number | Alternate titles |
|---|---|---|
| ALL MY LIFE | TEST-BMI-001 | |
| BREAK OUT | TEST-BMI-002 | |
| JANE DOE | TEST-BMI-003 | |
`;
      const works = parseBmiWorksMarkdown(markdown);
      expect(works).toHaveLength(3);
      expect(works[0]).toEqual({
        title: 'All My Life',
        bmiWorkNumber: 'TEST-BMI-001',
        writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
      });
      expect(works[1].bmiWorkNumber).toBe('TEST-BMI-002');
      expect(works[2].bmiWorkNumber).toBe('TEST-BMI-003');
    });

    it('parses CD Baby and archive data from JSON string or object', () => {
      const cdBabyJson = JSON.stringify([
        {
          release: 'Test Album',
          artist: 'Test Artist',
          tracks: [{ title: 'Track One', isrc: 'TEST-ISRC-01' }],
        },
      ]);
      expect(parseCdBabyData(cdBabyJson)).toHaveLength(1);

      const archiveJson = JSON.stringify([
        {
          title: 'Archive Song',
          artist: 'Performer',
          category: 'original',
          url: 'https://example.invalid/song.mp3',
        },
      ]);
      expect(parseArchiveSongs(archiveJson)).toHaveLength(1);
    });
  });

  describe('assembleCatalog', () => {
    it('merges BMI works, CD Baby releases, and Dropbox archive recordings', () => {
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
            tracks: [{ title: 'Break Out' }],
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
      expect(song.recordings[0].release).toBe('Solo Acoustic');
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

  describe('dry run and idempotent apply sync', () => {
    it('dry run reports planned operations without modifying store, apply persists, re-run is idempotent', async () => {
      const storeData: SongCatalogDoc[] = [
        {
          _id: 'existing-id-1',
          title: 'Existing Song',
          artist: 'Josh Sherman',
          category: 'original',
          writers: [],
          recordings: [],
        },
      ];

      const catalog: SongCatalogDoc[] = [
        {
          title: 'Existing Song',
          artist: 'Josh Sherman',
          category: 'original',
          bmiWorkNumber: 'TEST-BMI-EX1',
          writers: [{ name: 'Joshua Victor Sherman', share: 100 }],
          recordings: [{ release: 'Live Vol 1', artist: 'Josh Sherman' }],
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
          }
          return Promise.resolve({});
        },
        insertOne: (doc: Record<string, unknown>) => {
          const newDoc = { _id: `id-${storeData.length + 1}`, ...doc } as unknown as SongCatalogDoc;
          storeData.push(newDoc);
          return Promise.resolve({});
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
      expect(storeData[1].title).toBe('Brand New Song');
      expect(storeData[1].url).toBeUndefined(); // sparse uniqueness check

      // 3. Second apply run (idempotent)
      const secondApply = await executeCatalogSync(store, catalog, true, log);
      expect(secondApply.inserted).toBe(0);
      expect(secondApply.updated).toBe(0);
      expect(secondApply.unchanged).toBe(2);
      expect(storeData).toHaveLength(2);
    });
  });

  describe('resolveSources and run()', () => {
    it('resolves fallback baseline data when source files do not exist', () => {
      const sources = resolveSources({
        apply: false,
        force: false,
        bmiFile: '/nonexistent/bmi.md',
        cdBabyFile: '/nonexistent/cdbaby.json',
        archiveFile: '/nonexistent/archive.json',
      });
      expect(sources.bmiWorks).toBeUndefined();
      expect(sources.cdBabyReleases).toBeDefined();
      expect(sources.cdBabyReleases!.length).toBeGreaterThan(0);
      expect(sources.archiveSongs).toBeDefined();
      expect(sources.archiveSongs!.length).toBeGreaterThan(0);
    });

    it('refuses to run against non-safe target database', async () => {
      const connect = vi.spyOn(mongoose, 'connect');
      const prodUri = ['mongodb', '+srv:', '//prod.example.invalid/release'].join('');
      await expect(run([], prodUri)).rejects.toThrow('Refusing: target database');
      expect(connect).not.toHaveBeenCalled();
    });

    it('disconnects mongoose even when connect fails', async () => {
      vi.spyOn(mongoose, 'connect').mockRejectedValue(new Error('Mongo network timeout'));
      const disconnect = vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
      const safeUri = ['mongodb:', '//127.0.0.1:27017/web-jam-test'].join('');

      await expect(run([], safeUri)).rejects.toThrow('Mongo network timeout');
      expect(disconnect).toHaveBeenCalled();
    });
  });
});

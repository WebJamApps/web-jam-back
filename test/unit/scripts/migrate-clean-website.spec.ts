// Unit tests for the #1008 venue-website-scheme migration script's logic.
// Importing the module must NOT touch Mongo or process.exit (no top-level
// side effects beyond dotenv) — run()'s isMain guard is never true under
// vitest.
//
// parseArgs/isSafeToRun/logSafetyBlock are shared (src/lib/migration-cli.ts,
// #980) and covered by their own test/unit/lib/migration-cli.spec.ts — not
// re-tested here to avoid duplicating that coverage.
import mongoose from 'mongoose';
import {
  run, classifyWebsite, buildPlans,
} from '#src/scripts/migrate-clean-website.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('migrate-clean-website (#1008)', () => {
  describe('classifyWebsite', () => {
    it('empty/absent values are left alone', () => {
      expect(classifyWebsite(undefined)).toEqual({ kind: 'empty' });
      expect(classifyWebsite('')).toEqual({ kind: 'empty' });
      expect(classifyWebsite('   ')).toEqual({ kind: 'empty' });
    });

    it('a schemeless value gets prefixed with https://', () => {
      expect(classifyWebsite('www.petedyerivercourse.com')).toEqual({
        kind: 'rewrite', newValue: 'https://www.petedyerivercourse.com',
      });
    });

    it('a bare domain (no www) also gets prefixed', () => {
      expect(classifyWebsite('example.com')).toEqual({ kind: 'rewrite', newValue: 'https://example.com' });
    });

    it('a schemeless value with a path/query still gets prefixed as-is', () => {
      expect(classifyWebsite('example.com/menu?x=1')).toEqual({
        kind: 'rewrite', newValue: 'https://example.com/menu?x=1',
      });
    });

    it('trims surrounding whitespace before classifying/rewriting', () => {
      expect(classifyWebsite('  www.example.com  ')).toEqual({ kind: 'rewrite', newValue: 'https://www.example.com' });
    });

    it('a value already starting http:// is left alone', () => {
      expect(classifyWebsite('http://www.example.com')).toEqual({ kind: 'already-schemed' });
    });

    it('a value already starting https:// is left alone (never re-rewritten)', () => {
      expect(classifyWebsite('https://www.example.com')).toEqual({ kind: 'already-schemed' });
    });

    it('a protocol-relative value is reported, not rewritten', () => {
      expect(classifyWebsite('//example.com')).toEqual({ kind: 'protocol-relative' });
    });

    it('an email address is junk, not a URL rewrite', () => {
      const result = classifyWebsite('booking@example.com');
      expect(result.kind).toBe('junk');
    });

    it('a bare venue name (free text, no domain) is junk', () => {
      const result = classifyWebsite("Pete Dyer's Rec Center");
      expect(result.kind).toBe('junk');
    });

    it('a dot-less bare word is junk', () => {
      expect(classifyWebsite('TBD').kind).toBe('junk');
    });
  });

  describe('buildPlans', () => {
    it('separates rewrite plans, protocol-relative, and junk; drops empty/already-schemed silently', () => {
      const venues = [
        { _id: 'a', name: 'A', website: 'www.example.com' }, // rewrite
        { _id: 'b', name: 'B', website: 'https://already.com' }, // already-schemed, dropped
        { _id: 'c', name: 'C', website: '//protocol-relative.com' }, // reported
        { _id: 'd', name: 'D', website: 'booking@example.com' }, // junk
        { _id: 'e', name: 'E', website: '' }, // empty, dropped
      ];
      const { plans, protocolRelative, junk } = buildPlans(venues);
      expect(plans).toEqual([{ venue: venues[0], newValue: 'https://www.example.com' }]);
      expect(protocolRelative.map((r) => r.venue._id)).toEqual(['c']);
      expect(junk.map((r) => r.venue._id)).toEqual(['d']);
    });
  });

  describe('run()', () => {
    let originalArgv: string[];
    let originalUri: string | undefined;

    beforeEach(() => {
      originalArgv = process.argv;
      originalUri = process.env.MONGO_DB_URI;
      process.env.MONGO_DB_URI = 'mongodb://localhost:27017/web-jam-test';
    });

    afterEach(() => {
      process.argv = originalArgv;
      if (originalUri === undefined) delete process.env.MONGO_DB_URI;
      else process.env.MONGO_DB_URI = originalUri;
      vi.restoreAllMocks();
    });

    function stubMongo(venues: { _id: string; name: string; website?: string }[]) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { website?: { $exists?: boolean } } | undefined;
        if (f?.website?.$exists === true) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      const fakeResult = {
        acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null,
      };
      const updateOneSpy = vi.spyOn(venueModel.Schema.collection, 'updateOne')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateOne>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateOneSpy, logSpy,
      };
    }

    it('dry run: plans confident rewrites, reports protocol-relative/junk separately, writes nothing', async () => {
      process.argv = ['node', 'migrate-clean-website.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const id3 = new mongoose.Types.ObjectId().toString();
      const id4 = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateOneSpy, logSpy } = stubMongo([
        { _id: id1, name: 'A', website: 'www.petedyerivercourse.com' },
        { _id: id2, name: 'B', website: 'https://already-schemed.com' },
        { _id: id3, name: 'C', website: '//protocol-relative.com' },
        { _id: id4, name: 'D', website: 'booking@example.com' },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalledWith({ website: { $exists: true, $ne: '' } });
      expect(updateOneSpy).not.toHaveBeenCalled();

      const lines = logSpy.mock.calls.map((c) => c[0]).filter((l): l is string => typeof l === 'string');
      const planLines = lines.filter((l) => l.includes('PLAN'));
      expect(planLines).toHaveLength(1);
      expect(planLines[0]).toContain('"www.petedyerivercourse.com" -> "https://www.petedyerivercourse.com"');

      expect(lines.some((l) => l.includes('PROTOCOL-RELATIVE'))).toBe(true);
      expect(lines.some((l) => l.includes('SKIPPED, NEEDS A HUMAN'))).toBe(true);
      const summary = lines.find((l) => l.includes('venue(s) scanned'));
      expect(summary).toContain('4 venue(s) scanned');
      expect(summary).toContain('1 would change');
      expect(summary).toContain('1 protocol-relative');
      expect(summary).toContain('1 junk');
    });

    it('apply: writes rewrite plans via the raw collection updateOne, never for reported venues', async () => {
      process.argv = ['node', 'migrate-clean-website.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy } = stubMongo([
        { _id: id1, name: 'A', website: 'www.example.com' },
        { _id: id2, name: 'B', website: '//protocol-relative.com' },
      ]);

      await run();

      expect(updateOneSpy).toHaveBeenCalledTimes(1);
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: new mongoose.Types.ObjectId(id1) },
        { $set: { website: 'https://www.example.com' } },
      );
    });

    it('is a no-op on re-run once every website is already schemed (idempotent)', async () => {
      process.argv = ['node', 'migrate-clean-website.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy, logSpy } = stubMongo([{ _id: id1, name: 'A', website: 'https://www.example.com' }]);

      await run();

      expect(updateOneSpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('0 would change');
    });
  });

  describe('SAFETY GUARD', () => {
    let originalArgv: string[];
    let originalUri: string | undefined;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalArgv = process.argv;
      originalUri = process.env.MONGO_DB_URI;
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = originalArgv;
      if (originalUri === undefined) delete process.env.MONGO_DB_URI;
      else process.env.MONGO_DB_URI = originalUri;
      vi.restoreAllMocks();
    });

    it('refuses to run against a prod-looking db without --force', async () => {
      process.argv = ['node', 'migrate-clean-website.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

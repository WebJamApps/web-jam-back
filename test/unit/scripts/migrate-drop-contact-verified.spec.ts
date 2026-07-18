// Unit tests for the #974 migration script's logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMain guard is never true under vitest.
import mongoose from 'mongoose';
import {
  isSafeToRun, parseArgs, run,
} from '#src/scripts/migrate-drop-contact-verified.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('migrate-drop-contact-verified (#974)', () => {
  describe('parseArgs', () => {
    it('reads --apply and --force flags', () => {
      expect(parseArgs([])).toEqual({ apply: false, force: false });
      expect(parseArgs(['--apply'])).toEqual({ apply: true, force: false });
      expect(parseArgs(['--force', '--apply'])).toEqual({ apply: true, force: true });
    });
  });

  describe('isSafeToRun', () => {
    it('allows a localhost URI', () => {
      expect(isSafeToRun('mongodb://localhost:27017/web-jam-dev', false)).toBe(true);
    });

    it('allows a 127.0.0.1 URI', () => {
      expect(isSafeToRun('mongodb://127.0.0.1:27017/anything', false)).toBe(true);
    });

    it('allows a DEV Atlas db name', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/web-jam-dev', false)).toBe(true);
    });

    it('allows a TEST db name', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/web-jam-test', false)).toBe(true);
    });

    it('blocks a prod-looking (release) db name without --force', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', false)).toBe(false);
    });

    it('allows a prod-looking db name when --force is passed', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', true)).toBe(true);
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

    // Everything Mongo-shaped is mocked via vi.spyOn and fully restored
    // afterEach — this repo's other spec files share these same facade
    // singletons in the same test process (fileParallelism: false), so a
    // leaked mock here would break them.
    function stubMongo(venues: { _id: string; name: string }[], modifiedCount?: number) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { contactVerified?: { $exists?: boolean } } | undefined;
        if (f?.contactVerified?.$exists === true) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      // #974 LESSON (from #954): the real fix writes via the RAW collection
      // (venueModel.Schema.collection.updateMany), NOT a schema-bound mongoose
      // model method — that's exactly the write path this test spies on, so a
      // regression back to a schema-bound update ($unset that mongoose strict
      // mode would silently strip) would be caught by updateManySpy simply
      // never being called.
      const fakeResult = { acknowledged: true, matchedCount: venues.length, modifiedCount: modifiedCount ?? venues.length, upsertedCount: 0, upsertedId: null };
      const updateManySpy = vi.spyOn(venueModel.Schema.collection, 'updateMany')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateMany>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateManySpy, logSpy,
      };
    }

    it('dry run: plans removal for every venue still carrying contactVerified, writes nothing', async () => {
      process.argv = ['node', 'migrate-drop-contact-verified.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateManySpy, logSpy } = stubMongo([
        { _id: id1, name: 'Slow Play Brewing' },
        { _id: id2, name: 'The Spot on Kirk' },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalledWith({ contactVerified: { $exists: true } });
      expect(updateManySpy).not.toHaveBeenCalled(); // dry run — no --apply
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('2 venue(s) scanned');
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(2);
      expect(planLines[0]).toContain('contactVerified removed');
    });

    it('apply: $unsets contactVerified via the RAW collection (never a schema-bound mongoose method)', async () => {
      process.argv = ['node', 'migrate-drop-contact-verified.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateManySpy } = stubMongo([{ _id: id1, name: 'Slow Play Brewing' }]);

      await run();

      expect(updateManySpy).toHaveBeenCalledWith(
        { contactVerified: { $exists: true } },
        { $unset: { contactVerified: '' } },
      );
      expect(updateManySpy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op on re-run once no venues still carry contactVerified (idempotent)', async () => {
      process.argv = ['node', 'migrate-drop-contact-verified.js', '--apply'];
      const { updateManySpy, logSpy } = stubMongo([]);

      await run();

      expect(updateManySpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('0 venue(s) scanned');
    });

    it('reports the modifiedCount the raw collection write returns', async () => {
      process.argv = ['node', 'migrate-drop-contact-verified.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { logSpy } = stubMongo(
        [{ _id: id1, name: 'A' }, { _id: id2, name: 'B' }],
        2,
      );

      await run();

      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) updated'),
      );
      expect(summary).toContain('2 venue(s) updated');
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
      process.argv = ['node', 'migrate-drop-contact-verified.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

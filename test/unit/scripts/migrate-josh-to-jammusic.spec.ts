// Unit tests for the #1058 migration script's logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMain guard is never true under vitest.
//
// parseArgs/isSafeToRun/logSafetyBlock are shared (src/lib/migration-cli.ts)
// and covered by their own test/unit/lib/migration-cli.spec.ts — not
// re-tested here to avoid duplicating that coverage.
import mongoose from 'mongoose';
import { run, OLD_ARTIST } from '#src/scripts/migrate-josh-to-jammusic.js';
import gigModel from '#src/model/gig/gig-facade.js';
import { DEFAULT_ARTIST } from '#src/lib/artist.js';

describe('migrate-josh-to-jammusic (#1058)', () => {
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

    function stubMongo(gigs: { _id: string; venue?: string }[], modifiedCount?: number) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(gigModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { artist?: string } | undefined;
        if (f?.artist === OLD_ARTIST) return Promise.resolve(gigs);
        return Promise.resolve([]);
      });
      const fakeResult = {
        acknowledged: true, matchedCount: gigs.length, modifiedCount: modifiedCount ?? gigs.length, upsertedCount: 0, upsertedId: null,
      };
      const updateManySpy = vi.spyOn(gigModel.Schema, 'updateMany')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof gigModel.Schema.updateMany>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateManySpy, logSpy,
      };
    }

    it('scopes the query to artist:"josh" only — never "tim" or field-less records', async () => {
      process.argv = ['node', 'migrate-josh-to-jammusic.js'];
      const { findSpy } = stubMongo([]);

      await run();

      expect(findSpy).toHaveBeenCalledWith({ artist: 'josh' });
      expect(findSpy).toHaveBeenCalledTimes(1);
    });

    it('dry run: plans the re-tag for every josh-tagged gig, writes nothing', async () => {
      process.argv = ['node', 'migrate-josh-to-jammusic.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { updateManySpy, logSpy } = stubMongo([
        { _id: id1, venue: 'The Bridge' },
        { _id: id2, venue: 'Slow Play Brewing' },
      ]);

      await run();

      expect(updateManySpy).not.toHaveBeenCalled(); // dry run — no --apply
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('gig(s) scanned'),
      );
      expect(summary).toContain('2 gig(s) scanned');
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(2);
      expect(planLines[0]).toContain('"josh" -> "jammusic"');
    });

    it('apply: re-tags every josh-tagged gig to jammusic via updateMany', async () => {
      process.argv = ['node', 'migrate-josh-to-jammusic.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateManySpy } = stubMongo([{ _id: id1, venue: 'The Bridge' }]);

      await run();

      expect(updateManySpy).toHaveBeenCalledWith({ artist: OLD_ARTIST }, { artist: DEFAULT_ARTIST });
    });

    it('is a no-op on re-run once no gig still carries artist:"josh" (idempotent)', async () => {
      process.argv = ['node', 'migrate-josh-to-jammusic.js', '--apply'];
      const { updateManySpy, logSpy } = stubMongo([]);

      await run();

      expect(updateManySpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('gig(s) scanned'),
      );
      expect(summary).toContain('0 gig(s) scanned');
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
      process.argv = ['node', 'migrate-josh-to-jammusic.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

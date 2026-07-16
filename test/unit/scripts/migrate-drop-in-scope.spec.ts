// Unit tests for the #954 migration script's logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMain guard is never true under vitest.
import mongoose from 'mongoose';
import {
  isSafeToRun, parseArgs, run,
} from '#src/scripts/migrate-drop-in-scope.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('migrate-drop-in-scope (#954)', () => {
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
    function stubMongo(venues: { _id: string; name: string; inScope?: boolean }[]) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { inScope?: { $exists?: boolean } } | undefined;
        if (f?.inScope?.$exists === true) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      const updateSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateSpy, logSpy,
      };
    }

    it('dry run: plans doNotContact for inScope:false, plans field-only removal for inScope:true, writes nothing', async () => {
      process.argv = ['node', 'migrate-drop-in-scope.js']; // no --apply
      const outOfScopeId = new mongoose.Types.ObjectId().toString();
      const inScopeId = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateSpy, logSpy } = stubMongo([
        { _id: outOfScopeId, name: 'Salem Red Sox', inScope: false },
        { _id: inScopeId, name: 'The Spot', inScope: true },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalledWith({ inScope: { $exists: true } });
      expect(updateSpy).not.toHaveBeenCalled(); // dry run — no --apply
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('2 venue(s) scanned');
      expect(summary).toContain('1 were inScope:false');
      expect(summary).toContain('1 just lose the field');
    });

    it('apply: flips inScope:false venues to doNotContact:true and unsets inScope on both', async () => {
      process.argv = ['node', 'migrate-drop-in-scope.js', '--apply'];
      const outOfScopeId = new mongoose.Types.ObjectId().toString();
      const inScopeId = new mongoose.Types.ObjectId().toString();
      const { updateSpy } = stubMongo([
        { _id: outOfScopeId, name: 'Salem Red Sox', inScope: false },
        { _id: inScopeId, name: 'The Spot', inScope: true },
      ]);

      await run();

      expect(updateSpy).toHaveBeenCalledWith(outOfScopeId, {
        $unset: { inScope: '' }, $set: { doNotContact: true },
      });
      expect(updateSpy).toHaveBeenCalledWith(inScopeId, { $unset: { inScope: '' } });
      expect(updateSpy).toHaveBeenCalledTimes(2);
    });

    it('apply: also flips an archived inScope:false venue (deliberate — #954)', async () => {
      process.argv = ['node', 'migrate-drop-in-scope.js', '--apply'];
      const archivedId = new mongoose.Types.ObjectId().toString();
      const { updateSpy } = stubMongo([
        {
          _id: archivedId, name: 'ODAC Tournament', inScope: false, status: 'archived',
        } as unknown as { _id: string; name: string; inScope?: boolean },
      ]);

      await run();

      expect(updateSpy).toHaveBeenCalledWith(archivedId, {
        $unset: { inScope: '' }, $set: { doNotContact: true },
      });
    });

    it('is a no-op on re-run once no venues still carry inScope (idempotent)', async () => {
      process.argv = ['node', 'migrate-drop-in-scope.js', '--apply'];
      const { updateSpy, logSpy } = stubMongo([]);

      await run();

      expect(updateSpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('0 venue(s) scanned');
    });
  });
});

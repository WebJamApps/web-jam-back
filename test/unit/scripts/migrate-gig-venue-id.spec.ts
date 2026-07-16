// Unit tests for the #958 migration script's pure logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMain guard is never true under vitest.
import mongoose from 'mongoose';
import {
  isSafeToRun, parseArgs, run,
} from '#src/scripts/migrate-gig-venue-id.js';
import venueModel from '#src/model/venue/venue-facade.js';
import gigModel from '#src/model/gig/gig-facade.js';

describe('migrate-gig-venue-id (#958)', () => {
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

  // web-jam-back#964 follow-up (Josh-approved, folded into #962's PR) — the
  // venue fetch must exclude archived venues, so an archived venue can
  // neither link a gig nor create an ambiguous same-name collision against an
  // active venue that should have matched cleanly. Everything Mongo-shaped is
  // mocked via vi.spyOn and fully restored afterEach — this repo's other spec
  // files share these same facade singletons in the same test process
  // (fileParallelism: false), so a leaked mock here would break them.
  describe('run() — archived venue exclusion', () => {
    let originalArgv: string[];
    let originalUri: string | undefined;

    beforeEach(() => {
      originalArgv = process.argv;
      originalUri = process.env.MONGO_DB_URI;
      process.argv = ['node', 'migrate-gig-venue-id.js']; // no --apply, no --force
      process.env.MONGO_DB_URI = 'mongodb://localhost:27017/web-jam-test';
    });

    afterEach(() => {
      process.argv = originalArgv;
      if (originalUri === undefined) delete process.env.MONGO_DB_URI;
      else process.env.MONGO_DB_URI = originalUri;
      vi.restoreAllMocks();
    });

    it('excludes an archived venue from matching (no link, no ambiguity vs. the active same-named venue)', async () => {
      const activeId = new mongoose.Types.ObjectId().toString();
      const archivedId = new mongoose.Types.ObjectId().toString();
      const gigId = new mongoose.Types.ObjectId().toString();

      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);

      // Stands in for Mongo's own filtering: only excludes the archived venue
      // when called with the exact status filter the fixed code now passes —
      // this test would fail against the pre-fix `find({})` call.
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const all = [
          { _id: activeId, name: 'The Spot' },
          { _id: archivedId, name: 'The Spot' },
        ];
        const f = filter as { status?: { $ne?: string } } | undefined;
        if (f?.status?.$ne === 'archived') return Promise.resolve([all[0]]);
        return Promise.resolve(all);
      });
      vi.spyOn(gigModel, 'find').mockResolvedValue([{ _id: gigId, venue: 'The Spot' }]);
      const updateSpy = vi.spyOn(gigModel, 'findByIdAndUpdate').mockResolvedValue({});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await run();

      expect(findSpy).toHaveBeenCalledWith({ status: { $ne: 'archived' } });
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('matched exactly one venue'),
      );
      expect(summary).toContain('1 matched exactly one venue by name');
      expect(summary).toContain('0 left unlinked');
      expect(updateSpy).not.toHaveBeenCalled(); // dry run — no --apply
    });
  });
});

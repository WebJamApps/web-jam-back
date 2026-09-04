// Unit tests for the #1059 migration script's logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMainModule guard is never true under vitest.
//
// parseArgs/isSafeToRun/maskMongoUri/logSafetyBlock/isMainModule are shared
// (src/lib/migration-cli.ts, #980) and covered by their own
// test/unit/lib/migration-cli.spec.ts — not re-tested here to avoid
// duplicating that coverage.
//
// The apply-path assertions deliberately target the RAW collection
// (venueModel.Schema.collection.updateMany), not venueModel.findByIdAndUpdate:
// mongoose strict mode casts away an $unset of a path that no longer exists
// in the schema, so a spy on the schema-bound method would stay green on a
// migration that removes nothing (the #954 lesson — see the script header).
import mongoose from 'mongoose';
import { run } from '#src/scripts/migrate-drop-venue-legacy-fields.js';
import venueModel from '#src/model/venue/venue-facade.js';

type StubVenue = {
  _id: string;
  name: string;
  payTier?: string;
  originalsFit?: string;
  travelBand?: string;
  interested?: boolean;
  relationshipStage?: string;
  priority?: number;
  status?: string;
};

const LEGACY_FILTER = {
  $or: [
    { payTier: { $exists: true } },
    { originalsFit: { $exists: true } },
    { travelBand: { $exists: true } },
    { interested: { $exists: true } },
    { relationshipStage: { $exists: true } },
    { priority: { $exists: true } },
  ],
};

describe('migrate-drop-venue-legacy-fields (#1059)', () => {
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
    function stubMongo(venues: StubVenue[], modifiedCount?: number) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { $or?: Record<string, { $exists?: boolean }>[] } | undefined;
        if (f?.$or) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      const fakeResult = {
        acknowledged: true, matchedCount: venues.length, modifiedCount: modifiedCount ?? venues.length, upsertedCount: 0, upsertedId: null,
      };
      const updateManySpy = vi.spyOn(venueModel.Schema.collection, 'updateMany')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateMany>);
      const findByIdSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateManySpy, findByIdSpy, logSpy,
      };
    }

    it('dry run: plans an $unset of only the legacy fields each venue actually carries, writes nothing', async () => {
      process.argv = ['node', 'migrate-drop-venue-legacy-fields.js']; // no --apply
      const fullId = new mongoose.Types.ObjectId().toString();
      const partialId = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateManySpy, logSpy } = stubMongo([
        {
          _id: fullId,
          name: 'Olde Salem',
          payTier: '$$',
          originalsFit: 'loves',
          travelBand: 'local',
          interested: true,
          relationshipStage: 'returning',
          priority: 5,
        },
        { _id: partialId, name: 'The Spot', payTier: '$' },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalledWith(LEGACY_FILTER);
      expect(updateManySpy).not.toHaveBeenCalled(); // dry run — no --apply
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(2);
      expect(planLines[0]).toContain('unset [payTier, originalsFit, travelBand, interested, relationshipStage, priority]');
      expect(planLines[1]).toContain('unset [payTier]');
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('2 venue(s) scanned');
    });

    it('apply: unsets the legacy fields via a RAW collection updateMany, never a schema-bound update', async () => {
      process.argv = ['node', 'migrate-drop-venue-legacy-fields.js', '--apply'];
      const fullId = new mongoose.Types.ObjectId().toString();
      const partialId = new mongoose.Types.ObjectId().toString();
      const { updateManySpy, findByIdSpy, logSpy } = stubMongo([
        {
          _id: fullId,
          name: 'Olde Salem',
          payTier: '$$',
          originalsFit: 'loves',
          travelBand: 'local',
          interested: true,
          relationshipStage: 'returning',
          priority: 5,
        },
        { _id: partialId, name: 'The Spot', payTier: '$' },
      ], 2);

      await run();

      expect(updateManySpy).toHaveBeenCalledWith(LEGACY_FILTER, {
        $unset: {
          payTier: '', originalsFit: '', travelBand: '', interested: '', relationshipStage: '', priority: '',
        },
      });
      expect(updateManySpy).toHaveBeenCalledTimes(1);
      // A schema-bound write would be cast away by strict mode once the six
      // fields left venue-schema.ts — the whole point of the raw path.
      expect(findByIdSpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) updated'),
      );
      expect(summary).toContain('2 venue(s) updated');
    });

    it('apply: also updates an archived venue carrying legacy fields (mirrors migrate-drop-in-scope)', async () => {
      process.argv = ['node', 'migrate-drop-venue-legacy-fields.js', '--apply'];
      const archivedId = new mongoose.Types.ObjectId().toString();
      const { updateManySpy, logSpy } = stubMongo([
        {
          _id: archivedId, name: 'ODAC Tournament', priority: 5, status: 'archived',
        },
      ]);

      await run();

      // The candidate filter carries no status scope, so the archived venue
      // is both planned and covered by the raw write.
      expect(updateManySpy).toHaveBeenCalledWith(LEGACY_FILTER, expect.objectContaining({
        $unset: expect.objectContaining({ priority: '' }),
      }));
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('WRITE'),
      );
      expect(planLines).toHaveLength(1);
      expect(planLines[0]).toContain('ODAC Tournament');
    });

    it('is a no-op on re-run once no venues still carry any legacy field (idempotent)', async () => {
      process.argv = ['node', 'migrate-drop-venue-legacy-fields.js', '--apply'];
      const { updateManySpy, logSpy } = stubMongo([]);

      await run();

      expect(updateManySpy).not.toHaveBeenCalled();
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('0 venue(s) scanned');
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
      process.argv = ['node', 'migrate-drop-venue-legacy-fields.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

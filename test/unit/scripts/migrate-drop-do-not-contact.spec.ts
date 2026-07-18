// Unit tests for the #980 migration script's logic. Importing the module
// must NOT touch Mongo or process.exit (no top-level side effects beyond
// dotenv) — run()'s isMain guard is never true under vitest.
//
// parseArgs/isSafeToRun/logSafetyBlock are shared (src/lib/migration-cli.ts,
// #980) and covered by their own test/unit/lib/migration-cli.spec.ts — not
// re-tested here to avoid duplicating that coverage.
import mongoose from 'mongoose';
import { run, buildNoteLine } from '#src/scripts/migrate-drop-do-not-contact.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('migrate-drop-do-not-contact (#980)', () => {
  describe('buildNoteLine', () => {
    it('produces a dated line recording the prior exclusion', () => {
      const line = buildNoteLine(new Date('2026-07-18T12:00:00Z'));
      expect(line).toContain('[2026-07-18]');
      expect(line).toContain('doNotContact:true');
      expect(line).toContain('outreachEligible:false');
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

    function stubMongo(venues: { _id: string; name: string; doNotContact?: boolean; notes?: string }[], modifiedCount?: number) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { doNotContact?: { $exists?: boolean } } | undefined;
        if (f?.doNotContact?.$exists === true) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      const fakeResult = {
        acknowledged: true, matchedCount: venues.length, modifiedCount: modifiedCount ?? venues.length, upsertedCount: 0, upsertedId: null,
      };
      const updateManySpy = vi.spyOn(venueModel.Schema.collection, 'updateMany')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateMany>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateManySpy, logSpy,
      };
    }

    it('dry run: plans the flip for doNotContact:true venues, writes nothing', async () => {
      process.argv = ['node', 'migrate-drop-do-not-contact.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateManySpy, logSpy } = stubMongo([
        { _id: id1, name: 'Salem Red Sox', doNotContact: true },
        { _id: id2, name: 'ODAC Tournament', doNotContact: true, notes: 'existing note' },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalledWith({ doNotContact: { $exists: true } });
      expect(updateManySpy).not.toHaveBeenCalled(); // dry run — no --apply
      const summary = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('venue(s) scanned'),
      );
      expect(summary).toContain('2 venue(s) scanned');
      expect(summary).toContain('2 were doNotContact:true');
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(2);
      expect(planLines[0]).toContain('outreachEligible:false');
    });

    it('a venue with doNotContact set to something other than true just loses the field (no flip)', async () => {
      process.argv = ['node', 'migrate-drop-do-not-contact.js'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { logSpy } = stubMongo([{ _id: id1, name: 'Stray Field', doNotContact: false }]);

      await run();

      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(1);
      expect(planLines[0]).toContain('was not true');
      expect(planLines[0]).not.toContain('outreachEligible:false');
    });

    it('apply: flips doNotContact:true venues via a RAW pipeline updateMany (outreachEligible false + note appended + field unset)', async () => {
      process.argv = ['node', 'migrate-drop-do-not-contact.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateManySpy } = stubMongo([{ _id: id1, name: 'Salem Red Sox', doNotContact: true }]);

      await run();

      expect(updateManySpy).toHaveBeenCalledWith(
        { doNotContact: true },
        expect.arrayContaining([
          expect.objectContaining({
            $set: expect.objectContaining({ outreachEligible: false, notes: expect.anything() }),
          }),
          { $unset: 'doNotContact' },
        ]),
      );
    });

    it('apply: a venue with doNotContact != true is $unset via a separate RAW call, no outreachEligible/notes touch', async () => {
      process.argv = ['node', 'migrate-drop-do-not-contact.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateManySpy } = stubMongo([{ _id: id1, name: 'Stray Field', doNotContact: false }]);

      await run();

      expect(updateManySpy).toHaveBeenCalledWith(
        { doNotContact: { $exists: true, $ne: true } },
        { $unset: { doNotContact: '' } },
      );
    });

    it('is a no-op on re-run once no venues still carry doNotContact (idempotent)', async () => {
      process.argv = ['node', 'migrate-drop-do-not-contact.js', '--apply'];
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
      process.argv = ['node', 'migrate-drop-do-not-contact.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

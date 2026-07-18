// Unit tests for the #980 city-cleanup migration script's logic. Importing
// the module must NOT touch Mongo or process.exit (no top-level side effects
// beyond dotenv) — run()'s isMain guard is never true under vitest.
import mongoose from 'mongoose';
import {
  isSafeToRun, parseArgs, run,
  splitEmbeddedState, isTitleCased, resolveCanonicalCasing,
  buildSplitPlans, buildFinalPlans,
} from '#src/scripts/migrate-clean-city.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('migrate-clean-city (#980)', () => {
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

    it('blocks a prod-looking (release) db name without --force', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', false)).toBe(false);
    });

    it('allows a prod-looking db name when --force is passed', () => {
      expect(isSafeToRun('mongodb+srv://user:pass@cluster.mongodb.net/release', true)).toBe(true);
    });
  });

  describe('splitEmbeddedState', () => {
    it('no-change when there is no comma at all', () => {
      expect(splitEmbeddedState('Salem', undefined)).toEqual({ kind: 'no-change' });
    });

    it('splits a clean "City, ST" pattern when usState is empty', () => {
      expect(splitEmbeddedState('Salem, VA', undefined)).toEqual({ kind: 'split', city: 'Salem', state: 'VA' });
    });

    it('splits a multi-word city with an embedded state', () => {
      expect(splitEmbeddedState('Winston-Salem, NC', '')).toEqual({ kind: 'split', city: 'Winston-Salem', state: 'NC' });
    });

    it('still splits (redundantly) when usState already agrees', () => {
      expect(splitEmbeddedState('Salem, VA', 'VA')).toEqual({ kind: 'split', city: 'Salem', state: 'VA' });
    });

    it('is case-insensitive against an existing usState', () => {
      expect(splitEmbeddedState('Salem, va', 'VA')).toEqual({ kind: 'split', city: 'Salem', state: 'VA' });
    });

    it('ambiguous when the embedded state conflicts with an existing usState', () => {
      const result = splitEmbeddedState('Salem, VA', 'NC');
      expect(result.kind).toBe('ambiguous');
      expect((result as { reason: string }).reason).toContain('conflicts');
    });

    it('ambiguous when the comma is present but not a clean 2-letter-code pattern (full state name)', () => {
      const result = splitEmbeddedState('Salem, Virginia', undefined);
      expect(result.kind).toBe('ambiguous');
    });

    it('ambiguous when there is no city text before the comma', () => {
      const result = splitEmbeddedState(', VA', undefined);
      expect(result.kind).toBe('ambiguous');
    });
  });

  describe('isTitleCased', () => {
    it('accepts a simple properly-cased single word', () => {
      expect(isTitleCased('Salem')).toBe(true);
    });

    it('accepts a multi-word properly-cased city', () => {
      expect(isTitleCased('Winston-Salem')).toBe(true);
      expect(isTitleCased('St. Louis')).toBe(true);
    });

    it('rejects ALL CAPS', () => {
      expect(isTitleCased('SALEM')).toBe(false);
    });

    it('rejects all lowercase', () => {
      expect(isTitleCased('salem')).toBe(false);
    });

    it('rejects untrimmed input', () => {
      expect(isTitleCased(' Salem ')).toBe(false);
    });
  });

  describe('resolveCanonicalCasing', () => {
    it('a single variant needs no canonicalization', () => {
      const { canonicalMap, ambiguousGroups } = resolveCanonicalCasing(['Salem']);
      expect(canonicalMap.get('Salem')).toBe('Salem');
      expect(ambiguousGroups).toHaveLength(0);
    });

    it('picks the single title-cased variant as canonical for a casing group', () => {
      const { canonicalMap } = resolveCanonicalCasing(['Salem', 'SALEM', 'salem']);
      expect(canonicalMap.get('Salem')).toBe('Salem');
      expect(canonicalMap.get('SALEM')).toBe('Salem');
      expect(canonicalMap.get('salem')).toBe('Salem');
    });

    it('reports ambiguous when no variant in the group is title-cased', () => {
      const { ambiguousGroups, canonicalMap } = resolveCanonicalCasing(['SALEM', 'salem']);
      expect(ambiguousGroups).toHaveLength(1);
      expect(ambiguousGroups[0].variants.sort()).toEqual(['SALEM', 'salem']);
      expect(canonicalMap.has('SALEM')).toBe(false);
    });

    it('reports ambiguous when two DIFFERENT title-cased variants disagree (e.g. DeKalb vs Dekalb)', () => {
      const { ambiguousGroups } = resolveCanonicalCasing(['DeKalb', 'Dekalb']);
      expect(ambiguousGroups).toHaveLength(1);
      expect(ambiguousGroups[0].variants.sort()).toEqual(['DeKalb', 'Dekalb']);
    });

    it('different cities do not interfere with each other', () => {
      const { canonicalMap } = resolveCanonicalCasing(['Salem', 'SALEM', 'Roanoke']);
      expect(canonicalMap.get('Roanoke')).toBe('Roanoke');
      expect(canonicalMap.get('SALEM')).toBe('Salem');
    });
  });

  describe('buildSplitPlans', () => {
    it('separates split-ambiguous venues from working (split or no-change) ones', () => {
      const venues = [
        { _id: 'a', name: 'A', city: 'Salem, VA' },
        { _id: 'b', name: 'B', city: 'Salem, Virginia' }, // ambiguous
        { _id: 'c', name: 'C', city: 'Roanoke' },
      ];
      const { working, ambiguous } = buildSplitPlans(venues);
      expect(working.map((w) => w.venue._id)).toEqual(['a', 'c']);
      expect(ambiguous.map((a) => a.venue._id)).toEqual(['b']);
      expect(working[0]).toMatchObject({ city: 'Salem', state: 'VA' });
      expect(working[1]).toMatchObject({ city: 'Roanoke' });
    });
  });

  describe('buildFinalPlans', () => {
    it('plans a city rewrite for a casing variant with a confident canonical form', () => {
      const working = [
        { venue: { _id: 'a', name: 'A', city: 'SALEM' }, city: 'SALEM' },
        { venue: { _id: 'b', name: 'B', city: 'Salem' }, city: 'Salem' },
      ];
      const { plans, ambiguous } = buildFinalPlans(working);
      expect(ambiguous).toHaveLength(0);
      const planA = plans.find((p) => p.venue._id === 'a');
      expect(planA).toMatchObject({ finalCity: 'Salem' });
      // 'b' is already canonical — no-op, not in the plan list.
      expect(plans.find((p) => p.venue._id === 'b')).toBeUndefined();
    });

    it('plans a usState set only when usState was empty', () => {
      const working = [{ venue: { _id: 'a', name: 'A', city: 'Salem, VA', usState: '' }, city: 'Salem', state: 'VA' }];
      const { plans } = buildFinalPlans(working);
      expect(plans[0]).toMatchObject({ finalCity: 'Salem', finalUsState: 'VA' });
    });

    it('does not overwrite an existing usState even when the split state agrees', () => {
      const working = [{ venue: { _id: 'a', name: 'A', city: 'Salem, VA', usState: 'VA' }, city: 'Salem', state: 'VA' }];
      const { plans } = buildFinalPlans(working);
      expect(plans[0].finalUsState).toBeUndefined();
      expect(plans[0].finalCity).toBe('Salem'); // city itself still gets the redundant ", VA" stripped
    });

    it('reports a casing-ambiguous group and leaves those venues out of plans', () => {
      const working = [
        { venue: { _id: 'a', name: 'A', city: 'SALEM' }, city: 'SALEM' },
        { venue: { _id: 'b', name: 'B', city: 'salem' }, city: 'salem' },
      ];
      const { plans, ambiguous } = buildFinalPlans(working);
      expect(plans).toHaveLength(0);
      expect(ambiguous.map((a) => a.venue._id).sort()).toEqual(['a', 'b']);
      expect(ambiguous[0].reason).toContain('casing variants disagree');
    });

    it('a venue whose city is already canonical produces no plan (idempotent)', () => {
      const working = [{ venue: { _id: 'a', name: 'A', city: 'Salem' }, city: 'Salem' }];
      const { plans, ambiguous } = buildFinalPlans(working);
      expect(plans).toHaveLength(0);
      expect(ambiguous).toHaveLength(0);
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

    function stubMongo(venues: { _id: string; name: string; city?: string; usState?: string }[]) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation((filter: unknown) => {
        const f = filter as { city?: { $exists?: boolean } } | undefined;
        if (f?.city?.$exists === true) return Promise.resolve(venues);
        return Promise.resolve([]);
      });
      const fakeResult = { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
      const updateOneSpy = vi.spyOn(venueModel.Schema.collection, 'updateOne')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateOne>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      return {
        findSpy, updateOneSpy, logSpy,
      };
    }

    it('dry run: plans confident rewrites and reports ambiguous cases, writes nothing', async () => {
      process.argv = ['node', 'migrate-clean-city.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const id3 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy, logSpy } = stubMongo([
        { _id: id1, name: 'A', city: 'SALEM' },
        { _id: id2, name: 'B', city: 'Salem' },
        { _id: id3, name: 'C', city: 'Salem, Virginia' }, // split-ambiguous
      ]);

      await run();

      expect(updateOneSpy).not.toHaveBeenCalled();
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(1); // only "SALEM" -> "Salem" changes
      expect(planLines[0]).toContain('"SALEM" -> "Salem"');
      const ambiguousHeader = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('AMBIGUOUS'),
      );
      expect(ambiguousHeader).toBeTruthy();
    });

    it('apply: writes confident plans via the raw collection updateOne, never for ambiguous venues', async () => {
      process.argv = ['node', 'migrate-clean-city.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy } = stubMongo([{ _id: id1, name: 'A', city: 'SALEM' }, { _id: id2, name: 'B', city: 'Salem' }]);
      await run();
      // Only "SALEM" (venue A) needs a write; "Salem" (venue B) is already canonical.
      expect(updateOneSpy).toHaveBeenCalledTimes(1);
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: new mongoose.Types.ObjectId(id1) },
        { $set: { city: 'Salem' } },
      );
    });

    it('apply: a single clean venue writes city + usState in one $set', async () => {
      process.argv = ['node', 'migrate-clean-city.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy } = stubMongo([{ _id: id1, name: 'A', city: 'Salem, VA', usState: '' }]);

      await run();

      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: new mongoose.Types.ObjectId(id1) },
        { $set: { city: 'Salem', usState: 'VA' } },
      );
    });

    it('is a no-op on re-run once every city is already canonical (idempotent)', async () => {
      process.argv = ['node', 'migrate-clean-city.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy, logSpy } = stubMongo([{ _id: id1, name: 'A', city: 'Salem' }]);

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
      process.argv = ['node', 'migrate-clean-city.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/release';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

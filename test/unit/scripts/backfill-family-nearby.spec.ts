// Unit tests for the #1060 backfill-family-nearby script logic.
import mongoose from 'mongoose';
import {
  buildFamilyNearbyPlans, executeBackfillWrites, run, type VenueBackfillDoc,
} from '#src/scripts/backfill-family-nearby.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('backfill-family-nearby (#1060)', () => {
  describe('buildFamilyNearbyPlans', () => {
    it('computes familyNearby and detects whether an update write is needed', () => {
      const venues: VenueBackfillDoc[] = [
        // Salem venue, currently unset -> needs write to true
        {
          _id: '1', name: 'Salem Spot', zipCode: '24153',
        },
        // Marion venue, currently unset -> needs write to false
        {
          _id: '2', name: 'Marion Spot', zipCode: '24354',
        },
        // Salem venue, already true -> no write needed
        {
          _id: '3', name: 'Salem Known', zipCode: '24153', familyNearby: true,
        },
        // Marion venue, already false -> no write needed
        {
          _id: '4', name: 'Marion Known', zipCode: '24354', familyNearby: false,
        },
        // Marion venue with stale true -> needs write to false
        {
          _id: '5', name: 'Marion Stale', zipCode: '24354', familyNearby: true,
        },
        // Venue without name
        {
          _id: '6', zipCode: '24153',
        },
        // Venue with unresolvable coordinates -> coordinatesResolved: false, newValue: false
        {
          _id: '7', name: 'Nowhere Spot', zipCode: '00000', city: 'Nowhere',
        },
      ];

      const plans = buildFamilyNearbyPlans(venues);
      expect(plans).toHaveLength(7);

      expect(plans[0]).toEqual({
        venueId: '1',
        venueName: 'Salem Spot',
        currentValue: undefined,
        newValue: true,
        needsWrite: true,
        coordinatesResolved: true,
      });

      expect(plans[1]).toEqual({
        venueId: '2',
        venueName: 'Marion Spot',
        currentValue: undefined,
        newValue: false,
        needsWrite: true,
        coordinatesResolved: true,
      });

      expect(plans[2]).toEqual({
        venueId: '3',
        venueName: 'Salem Known',
        currentValue: true,
        newValue: true,
        needsWrite: false,
        coordinatesResolved: true,
      });

      expect(plans[3]).toEqual({
        venueId: '4',
        venueName: 'Marion Known',
        currentValue: false,
        newValue: false,
        needsWrite: false,
        coordinatesResolved: true,
      });

      expect(plans[4]).toEqual({
        venueId: '5',
        venueName: 'Marion Stale',
        currentValue: true,
        newValue: false,
        needsWrite: true,
        coordinatesResolved: true,
      });

      expect(plans[5].venueName).toBe('Unnamed Venue');
      expect(plans[5].needsWrite).toBe(true);
      expect(plans[5].coordinatesResolved).toBe(true);

      expect(plans[6]).toEqual({
        venueId: '7',
        venueName: 'Nowhere Spot',
        currentValue: undefined,
        newValue: false,
        needsWrite: true,
        coordinatesResolved: false,
      });
    });
  });

  describe('executeBackfillWrites', () => {
    it('only writes venues whose needsWrite is true', async () => {
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const fakeResult = { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
      const updateOneSpy = vi.spyOn(venueModel.Schema.collection, 'updateOne')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateOne>);

      const plans = [
        {
          venueId: id1, venueName: 'A', currentValue: undefined, newValue: true, needsWrite: true, coordinatesResolved: true,
        },
        {
          venueId: id2, venueName: 'B', currentValue: false, newValue: false, needsWrite: false, coordinatesResolved: true,
        },
      ];

      const modified = await executeBackfillWrites(plans);
      expect(modified).toBe(1);
      expect(updateOneSpy).toHaveBeenCalledTimes(1);
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: new mongoose.Types.ObjectId(id1) },
        { $set: { familyNearby: true } },
      );
      updateOneSpy.mockRestore();
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

    function stubMongo(venues: VenueBackfillDoc[]) {
      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);
      const findSpy = vi.spyOn(venueModel, 'find').mockImplementation(
        () => Promise.resolve(venues as unknown as Awaited<ReturnType<typeof venueModel.find>>),
      );
      const fakeResult = { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
      const updateOneSpy = vi.spyOn(venueModel.Schema.collection, 'updateOne')
        .mockImplementation(() => Promise.resolve(fakeResult) as unknown as ReturnType<typeof venueModel.Schema.collection.updateOne>);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      return {
        findSpy, updateOneSpy, logSpy, warnSpy,
      };
    }

    it('dry run: plans updates and executes zero database writes', async () => {
      process.argv = ['node', 'backfill-family-nearby.js']; // no --apply
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { findSpy, updateOneSpy, logSpy } = stubMongo([
        { _id: id1, name: 'Salem Spot', zipCode: '24153' },
        { _id: id2, name: 'Salem Already', zipCode: '24153', familyNearby: true },
      ]);

      await run();

      expect(findSpy).toHaveBeenCalled();
      expect(updateOneSpy).not.toHaveBeenCalled();
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines).toHaveLength(1);
      expect(planLines[0]).toContain('Salem Spot');
      expect(planLines[0]).toContain('unset -> true');
    });

    it('warns when venue coordinates are unresolvable and logs count in summary', async () => {
      process.argv = ['node', 'backfill-family-nearby.js'];
      const id = new mongoose.Types.ObjectId().toString();
      const { warnSpy, logSpy } = stubMongo([
        {
          _id: id, name: 'Mystery Venue', zipCode: '00000', city: 'Unknown',
        },
      ]);

      await run();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('coordinates could not be resolved from address/city/state/zipCode'),
      );
      const planLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('PLAN'),
      );
      expect(planLines[0]).toContain('[UNRESOLVED COORDINATES]');
      const summaryLine = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('Venues with unresolved coordinates: 1'),
      );
      expect(summaryLine).toBeTruthy();
    });

    it('apply: writes updates to Mongo via collection.updateOne', async () => {
      process.argv = ['node', 'backfill-family-nearby.js', '--apply'];
      const id1 = new mongoose.Types.ObjectId().toString();
      const id2 = new mongoose.Types.ObjectId().toString();
      const { updateOneSpy, logSpy } = stubMongo([
        { _id: id1, name: 'Salem Spot', zipCode: '24153' },
        { _id: id2, name: 'Marion Spot', zipCode: '24354' },
      ]);

      await run();

      expect(updateOneSpy).toHaveBeenCalledTimes(2);
      const writeLines = logSpy.mock.calls.map((c) => c[0]).filter(
        (l): l is string => typeof l === 'string' && l.includes('WRITE'),
      );
      expect(writeLines).toHaveLength(2);
      const summaryLine = logSpy.mock.calls.map((c) => c[0]).find(
        (l): l is string => typeof l === 'string' && l.includes('Venues modified in DB: 2'),
      );
      expect(summaryLine).toBeTruthy();
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

    it('refuses to run against non-dev/test database without --force', async () => {
      process.argv = ['node', 'backfill-family-nearby.js', '--apply'];
      process.env.MONGO_DB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/production';
      await expect(run()).rejects.toThrow('exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('only runs against a local, DEV, or TEST database'));
    });
  });
});

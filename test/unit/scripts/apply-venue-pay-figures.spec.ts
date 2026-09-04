// Unit tests for the #1061 apply-venue-pay-figures script.
// Importing the module must NOT touch Mongo or process.exit (no top-level
// side effects beyond dotenv) — run()'s isMain guard is never true under vitest.
import mongoose from 'mongoose';
import { run, VENUE_FIGURES } from '#src/scripts/apply-venue-pay-figures.js';
import venueModel from '#src/model/venue/venue-facade.js';

describe('apply-venue-pay-figures (#1061)', () => {
  describe('VENUE_FIGURES', () => {
    it('contains exactly nine venues with the approved amounts', () => {
      expect(VENUE_FIGURES).toHaveLength(9);
      expect(VENUE_FIGURES[0]).toEqual({ name: 'The Beast of Blacksburg', payAmount: 50 });
      expect(VENUE_FIGURES[1]).toEqual({ name: 'Radford Farmers Market', payAmount: 100 });
      expect(VENUE_FIGURES[2]).toEqual({ name: 'Pete Dye River Course', payAmount: 150 });
      expect(VENUE_FIGURES[3]).toEqual({ name: 'Tequilas Sports Bar and Grill', payAmount: 200 });
      expect(VENUE_FIGURES[4]).toEqual({ name: 'Stave & Cork', payAmount: 150 });
      expect(VENUE_FIGURES[5]).toEqual({
        name: 'Botetourt Farmers Market',
        payAmount: 0,
        noteToAdd: 'Agreed 50 for the 6 June 2026 market; never paid.',
      });
      expect(VENUE_FIGURES[6]).toEqual({ name: 'Salem Farmers Market', payAmount: 50 });
      expect(VENUE_FIGURES[7]).toEqual({ name: 'Harrisonburg Farmers Market', payAmount: 30 });
      expect(VENUE_FIGURES[8]).toEqual({ name: 'Hungry Mother State Park', payAmount: 150 });
    });
  });

  describe('run() — venue pay figure application', () => {
    let originalUri: string | undefined;

    beforeEach(() => {
      originalUri = process.env.MONGO_DB_URI;
      process.env.MONGO_DB_URI = 'mongodb://localhost:27017/web-jam-test';
    });

    afterEach(() => {
      if (originalUri === undefined) delete process.env.MONGO_DB_URI;
      else process.env.MONGO_DB_URI = originalUri;
      vi.restoreAllMocks();
    });

    it('updates each of nine venues with the correct payAmount', async () => {
      const venueIds = VENUE_FIGURES.map(() => new mongoose.Types.ObjectId().toString());

      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);

      // Mock findOne to return venue data for each requested venue
      const findOneSpy = vi.spyOn(venueModel, 'findOne').mockImplementation((filter: unknown) => {
        const f = filter as { name?: string } | undefined;
        const idx = VENUE_FIGURES.findIndex((v) => v.name === f?.name);
        if (idx === -1) return Promise.resolve(null);
        return Promise.resolve({
          _id: venueIds[idx],
          name: VENUE_FIGURES[idx].name,
          notes: undefined,
        });
      });

      const updateSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await run();

      // Verify each venue was looked up
      expect(findOneSpy).toHaveBeenCalledTimes(9);
      VENUE_FIGURES.forEach((figure) => {
        expect(findOneSpy).toHaveBeenCalledWith({ name: figure.name });
      });

      // Verify each venue was updated with correct payAmount
      expect(updateSpy).toHaveBeenCalledTimes(9);
      VENUE_FIGURES.forEach((figure, idx) => {
        const expectedUpdate: Record<string, unknown> = { payAmount: figure.payAmount };
        if (figure.noteToAdd) {
          expectedUpdate.notes = figure.noteToAdd;
        }
        expect(updateSpy).toHaveBeenNthCalledWith(idx + 1, venueIds[idx], expectedUpdate);
      });

      // Verify the log message shows all 9 found and 0 not found
      const summaryLog = logSpy.mock.calls
        .map((c) => c[0])
        .find((l): l is string => typeof l === 'string' && l.includes('venue(s) found and updated'));
      expect(summaryLog).toContain('9 venue(s) found and updated; 0 not found');
    });

    it('appends a note to Botetourt Farmers Market when notes are already present', async () => {
      const botetourt = VENUE_FIGURES.find((v) => v.name === 'Botetourt Farmers Market')!;
      const venueId = new mongoose.Types.ObjectId().toString();
      const existingNotes = 'Some existing note.';

      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);

      vi.spyOn(venueModel, 'findOne').mockImplementation((filter: unknown) => {
        const f = filter as { name?: string } | undefined;
        if (f?.name === 'Botetourt Farmers Market') {
          return Promise.resolve({
            _id: venueId,
            name: 'Botetourt Farmers Market',
            payAmount: undefined,
            notes: existingNotes,
          } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        return Promise.resolve(null);
      });

      const updateSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await run();

      // Verify the note was appended (not replaced)
      expect(updateSpy).toHaveBeenCalledWith(
        venueId,
        {
          payAmount: 0,
          notes: `${existingNotes} ${botetourt.noteToAdd}`,
        },
      );
    });

    it('appends a note to Botetourt Farmers Market when notes are undefined', async () => {
      const botetourt = VENUE_FIGURES.find((v) => v.name === 'Botetourt Farmers Market')!;
      const venueId = new mongoose.Types.ObjectId().toString();

      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);

      vi.spyOn(venueModel, 'findOne').mockImplementation((filter: unknown) => {
        const f = filter as { name?: string } | undefined;
        if (f?.name === 'Botetourt Farmers Market') {
          return Promise.resolve({
            _id: venueId,
            name: 'Botetourt Farmers Market',
            payAmount: undefined,
            notes: undefined,
          } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
        return Promise.resolve(null);
      });

      const updateSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await run();

      // Verify the note is just the new note (no existing text to append to)
      expect(updateSpy).toHaveBeenCalledWith(
        venueId,
        {
          payAmount: 0,
          notes: botetourt.noteToAdd,
        },
      );
    });

    it('continues processing all venues even when one is not found', async () => {
      const venueIds = VENUE_FIGURES.map(() => new mongoose.Types.ObjectId().toString());

      vi.spyOn(mongoose, 'connect').mockResolvedValue(undefined as unknown as typeof mongoose);
      vi.spyOn(mongoose.connection, 'close').mockResolvedValue(undefined);

      // Mock to return all venues except the third one
      vi.spyOn(venueModel, 'findOne').mockImplementation((filter: unknown) => {
        const f = filter as { name?: string } | undefined;
        const idx = VENUE_FIGURES.findIndex((v) => v.name === f?.name);
        if (idx === 2) return Promise.resolve(null); // Pete Dye River Course not found
        if (idx === -1) return Promise.resolve(null);
        return Promise.resolve({
          _id: venueIds[idx],
          name: VENUE_FIGURES[idx].name,
          notes: undefined,
        });
      });

      const updateSpy = vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await run();

      // Verify all 9 venues were looked up
      expect(logSpy).toHaveBeenCalledWith('  NOT FOUND: "Pete Dye River Course"');

      // Verify only 8 venues were updated (not the missing one)
      expect(updateSpy).toHaveBeenCalledTimes(8);

      // Verify the summary shows 8 found and 1 not found
      const summaryLog = logSpy.mock.calls
        .map((c) => c[0])
        .find((l): l is string => typeof l === 'string' && l.includes('venue(s) found and updated'));
      expect(summaryLog).toContain('8 venue(s) found and updated; 1 not found');
    });
  });
});

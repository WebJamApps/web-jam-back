// Unit tests for the shared venue<->gig resolution logic (web-jam-back#958).
import mongoose from 'mongoose';
import {
  normalizeVenueName, buildUnambiguousNameIndex, resolveGigVenueId, groupGigsByVenue, JOSH_GIGS_FILTER,
} from '#src/lib/gig-venue-link.js';

const oid = () => new mongoose.Types.ObjectId().toString();

describe('gig-venue-link (#958)', () => {
  describe('normalizeVenueName', () => {
    it('lowercases, strips punctuation, and collapses whitespace', () => {
      expect(normalizeVenueName("Durty Bull's Brewing Co.")).toBe('durty bulls brewing co');
      expect(normalizeVenueName('The   Spot,  Kirk')).toBe('the spot kirk');
      expect(normalizeVenueName('DURTY BULL')).toBe('durty bull');
    });

    it('treats differently-punctuated names as the same key', () => {
      expect(normalizeVenueName('Durty Bull Brewing Co.')).toBe(normalizeVenueName('Durty Bull Brewing Co'));
    });

    it('handles missing/empty input', () => {
      expect(normalizeVenueName(undefined)).toBe('');
      expect(normalizeVenueName(null)).toBe('');
      expect(normalizeVenueName('')).toBe('');
    });
  });

  describe('buildUnambiguousNameIndex', () => {
    it('indexes a unique normalized name to its venue id', () => {
      const id = oid();
      const index = buildUnambiguousNameIndex([{ _id: id, name: 'Durty Bull' }]);
      expect(index.get('durty bull')).toBe(id);
    });

    it('excludes a name shared by 2+ venues (ambiguous — never fuzzy)', () => {
      const index = buildUnambiguousNameIndex([
        { _id: oid(), name: 'The Spot' },
        { _id: oid(), name: 'the spot' },
      ]);
      expect(index.has('the spot')).toBe(false);
    });

    it('skips venues with no name', () => {
      const index = buildUnambiguousNameIndex([{ _id: oid() }]);
      expect(index.size).toBe(0);
    });
  });

  describe('resolveGigVenueId', () => {
    it('prefers venueId when present, without consulting the name index', () => {
      const venueId = oid();
      const index = new Map<string, string>(); // deliberately empty/unrelated
      expect(resolveGigVenueId({ venueId, venue: 'Unrelated Name' }, index)).toBe(venueId);
    });

    it('falls back to an exact normalized-name match when venueId is absent', () => {
      const venueId = oid();
      const index = new Map([['durty bull', venueId]]);
      expect(resolveGigVenueId({ venue: 'DURTY BULL' }, index)).toBe(venueId);
    });

    it('returns null when the name has no unambiguous match', () => {
      const index = new Map<string, string>();
      expect(resolveGigVenueId({ venue: 'Nowhere' }, index)).toBeNull();
    });

    it('returns null when venue text is empty and there is no venueId', () => {
      const index = new Map([['x', oid()]]);
      expect(resolveGigVenueId({ venue: '' }, index)).toBeNull();
    });
  });

  describe('groupGigsByVenue', () => {
    it('groups gigs by resolved venue id in one pass (no per-venue query)', () => {
      const venueA = { _id: oid(), name: 'The Spot' };
      const venueB = { _id: oid(), name: 'Durty Bull' };
      const gigs = [
        { _id: oid(), venue: 'The Spot', datetime: '2026-01-01' },
        { _id: oid(), venueId: venueB._id, venue: 'Somewhere Else Entirely' },
        { _id: oid(), venue: 'Unmatched Venue' },
      ];
      const groups = groupGigsByVenue(gigs, [venueA, venueB]);
      expect(groups.get(String(venueA._id))).toHaveLength(1);
      expect(groups.get(String(venueB._id))).toHaveLength(1);
      expect(groups.has('undefined')).toBe(false);
    });
  });

  describe('JOSH_GIGS_FILTER', () => {
    it("scopes to Josh's gigs or pre-#885 records with no artist field", () => {
      expect(JOSH_GIGS_FILTER).toEqual({ $or: [{ artist: 'josh' }, { artist: { $exists: false } }] });
    });
  });
});

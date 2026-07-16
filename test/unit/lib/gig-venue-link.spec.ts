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

    // web-jam-back#964: prod gig.venue values are TinyMCE HTML, e.g.
    // `<p><a href="https://www.slowplaybrewing.com/" target="_blank"
    // rel="noopener">Slow Play Brewing</a></p>` — 0/135 prod gigs matched
    // because tags/entities weren't stripped before comparing to plain names.
    it('strips a TinyMCE anchor-wrapped venue down to the link text', () => {
      const html = '<p><a href="https://www.slowplaybrewing.com/" target="_blank" rel="noopener">Slow Play Brewing</a></p>';
      expect(normalizeVenueName(html)).toBe(normalizeVenueName('Slow Play Brewing'));
    });

    it('decodes &amp;-style HTML entities before comparing', () => {
      const html = '<p>Smith &amp; Sons Tap Room</p>';
      expect(normalizeVenueName(html)).toBe(normalizeVenueName('Smith & Sons Tap Room'));
    });

    it('decodes numeric and hex HTML entities', () => {
      expect(normalizeVenueName('Tom&#39;s Bar')).toBe(normalizeVenueName("Tom's Bar"));
      expect(normalizeVenueName('Tom&#x27;s Bar')).toBe(normalizeVenueName("Tom's Bar"));
    });

    it('matches an unwrapped plain-text venue value identically to itself', () => {
      expect(normalizeVenueName('Durty Bull Brewing')).toBe(normalizeVenueName('Durty Bull Brewing'));
    });

    it('does NOT collapse a College-Lutheran-style long prose field into a real venue name', () => {
      const prose = '<p>Join us for worship this Sunday at 10am, followed by a potluck in the fellowship hall. '
        + 'All are welcome &amp; encouraged to bring a dish to share!</p>';
      const index = buildUnambiguousNameIndex([{ _id: oid(), name: 'Slow Play Brewing' }]);
      expect(index.get(normalizeVenueName(prose))).toBeUndefined();
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

    // web-jam-back#964 end-to-end: a gig with a real TinyMCE-shaped venue
    // field resolves against the plain-text venue name it links to, and a
    // long-prose (non-venue) field correctly resolves to nothing.
    it('resolves a TinyMCE HTML-wrapped gig.venue against a plain-text venue name', () => {
      const venueId = oid();
      const venues = [{ _id: venueId, name: 'Slow Play Brewing' }];
      const index = buildUnambiguousNameIndex(venues);
      const gig = {
        venue: '<p><a href="https://www.slowplaybrewing.com/" target="_blank" rel="noopener">Slow Play Brewing</a></p>',
      };
      expect(resolveGigVenueId(gig, index)).toBe(venueId);
    });

    it('resolves an HTML-wrapped gig.venue containing &amp; against a venue with a plain "&"', () => {
      const venueId = oid();
      const venues = [{ _id: venueId, name: 'Smith & Sons Tap Room' }];
      const index = buildUnambiguousNameIndex(venues);
      const gig = { venue: '<p>Smith &amp; Sons Tap Room</p>' };
      expect(resolveGigVenueId(gig, index)).toBe(venueId);
    });

    it('leaves a College-Lutheran-style long prose gig.venue unresolved', () => {
      const venues = [{ _id: oid(), name: 'Slow Play Brewing' }];
      const index = buildUnambiguousNameIndex(venues);
      const gig = {
        venue: '<p>Join us for worship this Sunday at 10am, followed by a potluck in the fellowship hall. '
          + 'All are welcome &amp; encouraged to bring a dish to share!</p>',
      };
      expect(resolveGigVenueId(gig, index)).toBeNull();
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

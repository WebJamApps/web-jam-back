import {
  DEFAULT_ARTIST, normalizeArtist, artistListFilter, artistGrantForEmail,
} from '#src/lib/artist.js';

describe('lib/artist', () => {
  const orig = process.env.ArtistAdmins;
  afterEach(() => { process.env.ArtistAdmins = orig; });

  it('exposes the default artist', () => {
    expect(DEFAULT_ARTIST).toBe('jammusic');
  });

  it('normalizeArtist falls back to the default for blank/non-string', () => {
    expect(normalizeArtist('tim')).toBe('tim');
    expect(normalizeArtist('  spaced  ')).toBe('spaced');
    expect(normalizeArtist('')).toBe('jammusic');
    expect(normalizeArtist(undefined)).toBe('jammusic');
    expect(normalizeArtist(42)).toBe('jammusic');
  });

  it('artistListFilter scopes to a specific artist', () => {
    expect(artistListFilter({ artist: 'tim', city: 'Salem' })).toEqual({ artist: 'tim', city: 'Salem' });
  });

  it('artistListFilter defaults to legacy + jammusic records', () => {
    const f = artistListFilter({ type: 'paperback' });
    expect(f.type).toBe('paperback');
    expect(f.$or).toEqual([{ artist: { $exists: false } }, { artist: null }, { artist: 'jammusic' }]);
  });

  it('artistListFilter treats an explicit jammusic like the default', () => {
    expect(artistListFilter({ artist: 'jammusic' }).$or).toBeDefined();
  });

  // web-jam-back#1058: this is exactly why Josh & Maria's 138 gig records,
  // explicitly tagged artist:'josh' pre-migration, matched none of the
  // default-tenant $or branches and GET /gig returned an empty array. The
  // #1058 migration re-tags those records to 'jammusic' so they match here.
  it("artistListFilter({}) matches a jammusic-tagged gig record but not a josh-tagged one (#1058)", () => {
    const filter = artistListFilter({});
    expect(filter.$or).toContainEqual({ artist: 'jammusic' });
    expect(filter.$or).not.toContainEqual({ artist: 'josh' });
  });

  it('artistGrantForEmail returns a slug-derived grant for a configured email (case-insensitive)', () => {
    process.env.ArtistAdmins = JSON.stringify({ 'tim@example.com': 'tim' });
    expect(artistGrantForEmail('Tim@Example.com')).toEqual({ userType: 'tim-admin', artist: 'tim' });
  });

  it('artistGrantForEmail returns null for an unlisted email', () => {
    process.env.ArtistAdmins = JSON.stringify({ 'tim@example.com': 'tim' });
    expect(artistGrantForEmail('someone@else.com')).toBeNull();
  });

  it('artistGrantForEmail returns null on missing/invalid config', () => {
    delete process.env.ArtistAdmins;
    expect(artistGrantForEmail('tim@example.com')).toBeNull();
    process.env.ArtistAdmins = 'not-json';
    expect(artistGrantForEmail('tim@example.com')).toBeNull();
  });
});

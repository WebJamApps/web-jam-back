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

  it('artistGrantForEmail returns a grant for a configured email (case-insensitive)', () => {
    process.env.ArtistAdmins = JSON.stringify({ 'tim@example.com': 'tim' });
    expect(artistGrantForEmail('Tim@Example.com')).toEqual({ userType: 'artist-admin', artist: 'tim' });
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

// Multi-artist (multi-tenant) scoping shared by the collections that more than
// one front-end reads from the same Mongo database (web-jam-back#885).
//
// Background: this backend originally served only the JaMmusic front-end. A new
// front-end (timshermanmusic.com) now reuses it. To keep both artists' data in
// the same collections without leaking across sites, records carry an `artist`
// slug. EVERY record that predates #885 has NO `artist` field, so those are
// treated as the original JaMmusic artist — existing behaviour is unchanged.

// The slug the pre-#885 (field-less) records belong to.
export const DEFAULT_ARTIST = 'jammusic';

// Coerce a possibly-missing/blank artist value to a concrete slug.
export function normalizeArtist(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_ARTIST;
}

// Build the Mongo filter for a PUBLIC list/find, given the request query.
// - `?artist=tim` (any non-default slug) -> exactly that artist's records.
// - no `artist` param, or `?artist=jammusic` -> the original artist, i.e. every
//   record whose `artist` is absent/null OR explicitly `jammusic`. This is what
//   makes the change backward compatible: legacy records still show up.
// Any other query params (e.g. ?type=paperback) are preserved.
export function artistListFilter(query: Record<string, unknown>): Record<string, unknown> {
  const { artist, ...rest } = query || {};
  const requested = typeof artist === 'string' && artist.trim() ? artist.trim() : DEFAULT_ARTIST;
  if (requested !== DEFAULT_ARTIST) return { ...rest, artist: requested };
  return {
    ...rest,
    $or: [{ artist: { $exists: false } }, { artist: null }, { artist: DEFAULT_ARTIST }],
  };
}

// Login-time role grant driven by the `ArtistAdmins` env var — a JSON map of
// lower-cased email -> artist slug, e.g. {"tim@example.com":"tim"}. A matched
// email is provisioned as an artist-scoped admin with a slug-derived userType
// (`<slug>-admin`, e.g. `tim-admin`), `artist` = the slug. This keeps per-tenant
// role names (like the pre-existing `clc-admin`) without hand-maintaining one
// per artist. Josh sets Tim's real email here; unmatched emails (incl. Josh's
// own Developer account) get no grant and are left untouched.
export function artistGrantForEmail(email: string): { userType: string; artist: string } | null {
  let map: Record<string, string>;
  try { map = JSON.parse(process.env.ArtistAdmins || '{}') as Record<string, string>; } catch { return null; }
  const key = (email || '').toLowerCase();
  // eslint-disable-next-line security/detect-object-injection
  const slug = map[key];
  return typeof slug === 'string' && slug ? { userType: `${slug}-admin`, artist: slug } : null;
}

export default {
  DEFAULT_ARTIST, normalizeArtist, artistListFilter, artistGrantForEmail,
};

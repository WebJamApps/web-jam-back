// src/lib/gig-venue-link.ts — web-jam-back#958
//
// Shared venue<->gig resolution logic (locked design, #955): a gig links to a
// venue via `venueId` first; failing that, an EXACT normalized-name match
// (case/punctuation-insensitive) against `venue.name` — NEVER fuzzy. A name
// that matches more than one venue is ambiguous and resolves to nothing (no
// guessing). This one module is the single source of truth for that rule, so
// the migration script (src/scripts/migrate-gig-venue-id.ts), GET /venue's
// lastGig/nextGig/locationFallback (venue-controller.ts), and the
// GET /outreach/candidates safety exclusion + weekend-gig surfacing
// (outreach-controller.ts) can never drift into three subtly different
// matching implementations.
//
// Gigs are shared across artists (#885); every caller here scopes its OWN gig
// query with JOSH_GIGS_FILTER (Josh & Maria's gigs, or pre-#885 records with no
// artist field) — mirrors the existing convention in venue-controller's
// filterEligible so Tim's calendar (#922) never leaks into Josh's venue/outreach
// linkage.
export const JOSH_GIGS_FILTER = { $or: [{ artist: 'josh' }, { artist: { $exists: false } }] };

export interface LinkableGig {
  _id?: unknown;
  venueId?: unknown;
  venue?: string;
  datetime?: Date | string;
  [key: string]: unknown;
}

export interface LinkableVenue {
  _id?: unknown;
  name?: string;
}

// Prod `gig.venue` values come from a TinyMCE rich-text field, e.g.
// `<p><a href="https://x.com/" target="_blank" rel="noopener">Slow Play
// Brewing</a></p>` — sometimes with HTML entities (`&amp;`). Both must be
// stripped/decoded BEFORE the punctuation/case normalization below, or the
// exact-match never fires (web-jam-back#964: 0/135 prod gigs matched).
// `<[^>]*>` is a negated-class quantifier — linear, no nested quantifiers,
// safe from catastrophic backtracking despite the generic slow-regex lint
// warning.
// eslint-disable-next-line sonarjs/slow-regex
const HTML_TAG_RE = /<[^>]*>/g;

// Common named entities TinyMCE/browsers emit, plus numeric/hex entities
// (&#39; / &#x27;). Decode named entities via a lookup table (no regex
// alternation blowup); numeric entities via two small linear regexes, applied
// first so a decoded `&#38;` doesn't get re-interpreted as the start of
// another entity.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const NAMED_ENTITY_RE = /&([a-zA-Z]+);/g;
const NUMERIC_ENTITY_RE = /&#(\d+);/g;
const HEX_ENTITY_RE = /&#x([0-9a-fA-F]+);/g;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(HEX_ENTITY_RE, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(NUMERIC_ENTITY_RE, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(NAMED_ENTITY_RE, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

// Strip HTML tags, decode entities, then lowercase + strip punctuation (keep
// letters/numbers/whitespace) + collapse whitespace. `[^\p{L}\p{N}\s]` is a
// negated Unicode-property class — linear, no nested quantifiers, safe from
// catastrophic backtracking despite the generic slow-regex lint warning.
// eslint-disable-next-line sonarjs/slow-regex
const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;
export function normalizeVenueName(name: string | undefined | null): string {
  return decodeHtmlEntities((name || '').replace(HTML_TAG_RE, ' '))
    .toLowerCase()
    .replace(PUNCTUATION_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build normalizedName -> venue _id (string), INCLUDING ONLY names unambiguous
// across the given venue list (exactly one venue owns that normalized name).
// A normalized name shared by 2+ venues is deliberately left out of the map —
// "never fuzzy" means an ambiguous name resolves to nothing, not a guess.
export function buildUnambiguousNameIndex(venues: LinkableVenue[]): Map<string, string> {
  const counts = new Map<string, string[]>();
  for (const v of venues) {
    const key = normalizeVenueName(v.name);
    if (!key) continue;
    const ids = counts.get(key) || [];
    ids.push(String(v._id));
    counts.set(key, ids);
  }
  const index = new Map<string, string>();
  for (const [key, ids] of counts) {
    if (ids.length === 1) index.set(key, ids[0]);
  }
  return index;
}

// Resolve which venue (by _id string) a gig belongs to, or null when
// unresolvable. venueId wins when present (trusted, no re-matching); otherwise
// an EXACT normalized-name match against the unambiguous index.
export function resolveGigVenueId(gig: LinkableGig, nameIndex: Map<string, string>): string | null {
  if (gig.venueId) return String(gig.venueId);
  const key = normalizeVenueName(gig.venue);
  if (!key) return null;
  return nameIndex.get(key) || null;
}

// Group gigs by resolved venue _id (string) — ONE pass over `gigs` (already
// fetched in a single query by the caller), never a per-venue query (no N+1).
export function groupGigsByVenue(gigs: LinkableGig[], venues: LinkableVenue[]): Map<string, LinkableGig[]> {
  const nameIndex = buildUnambiguousNameIndex(venues);
  const groups = new Map<string, LinkableGig[]>();
  for (const gig of gigs) {
    const venueId = resolveGigVenueId(gig, nameIndex);
    if (!venueId) continue;
    const list = groups.get(venueId) || [];
    list.push(gig);
    groups.set(venueId, list);
  }
  return groups;
}

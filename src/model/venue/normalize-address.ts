// src/model/venue/normalize-address.ts — web-jam-back#987
//
// Pure, table-driven address normalizer. Abbreviates USPS Publication 28
// street-suffix / directional / unit-designator words to their standard
// short form and Title-Cases the result, so the STORED `address` is always
// the same compact, Google-Maps-friendly form regardless of how it was
// typed (e.g. "1 Electric Road" and "1 Electric Rd" both normalize to the
// same string, which is what makes the venue-controller dedup in #987 work).
//
// No external API — this is a local, offline lookup table, deliberately
// (see #987's non-goals: no USPS/geocoding call on the create path).

// USPS Pub 28 street-suffix abbreviations. Table-driven so extending the list
// (more suffixes) is a one-line addition, never a code change.
export const STREET_SUFFIXES: Record<string, string> = {
  street: 'St',
  road: 'Rd',
  avenue: 'Ave',
  boulevard: 'Blvd',
  drive: 'Dr',
  lane: 'Ln',
  court: 'Ct',
  circle: 'Cir',
  highway: 'Hwy',
  place: 'Pl',
  parkway: 'Pkwy',
  terrace: 'Ter',
  trail: 'Trl',
  square: 'Sq',
  plaza: 'Plz',
  turnpike: 'Tpke',
};

// Directional prefixes/suffixes, plus the four compass compounds.
export const DIRECTIONALS: Record<string, string> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
  northeast: 'NE',
  northwest: 'NW',
  southeast: 'SE',
  southwest: 'SW',
};

// Unit designators.
export const UNIT_DESIGNATORS: Record<string, string> = {
  suite: 'Ste',
  apartment: 'Apt',
  building: 'Bldg',
  floor: 'Fl',
};

// Full-word (lowercase key) -> canonical abbreviation, merged from the three
// tables above. One combined lookup, used uniformly per token below.
const ABBREVIATIONS: Record<string, string> = {
  ...STREET_SUFFIXES,
  ...DIRECTIONALS,
  ...UNIT_DESIGNATORS,
};

// Reverse map: lowercased abbreviation -> its canonically-cased form (e.g.
// 'st' -> 'St', 'ne' -> 'NE'). This is what makes normalization idempotent —
// an address that's already abbreviated (e.g. "100 N Main St") normalizes to
// itself, rather than the naive per-word Title-Case mis-casing an already
// all-caps compass compound like "NE" down to "Ne" on a second pass.
const CANONICAL_ABBREVIATIONS: Record<string, string> = {};
Object.values(ABBREVIATIONS).forEach((abbr) => {
  CANONICAL_ABBREVIATIONS[abbr.toLowerCase()] = abbr;
});

// Title-case a plain alphabetic word (first letter up, rest down). Tokens
// containing digits/punctuation (house numbers, unit numbers, a bare '#',
// "I-81", etc.) are left untouched — there is no "case" to correct there.
function titleCaseWord(token: string): string {
  if (!/^[A-Za-z]+$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// Map one whitespace-delimited token through the abbreviation tables, falling
// back to Title Case for an ordinary word and to a no-op for anything else
// (numbers, a bare '#', a '#'-prefixed unit number like "#2" — the bare '#'
// is deliberately left exactly as typed; it's already the compact USPS form,
// so there is nothing to abbreviate or strip).
function normalizeToken(token: string): string {
  const key = token.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ABBREVIATIONS, key)) return ABBREVIATIONS[key];
  if (Object.prototype.hasOwnProperty.call(CANONICAL_ABBREVIATIONS, key)) return CANONICAL_ABBREVIATIONS[key];
  return titleCaseWord(token);
}

// Normalize a raw address string to the canonical stored form:
// collapse whitespace, trim, strip ',' and '.', abbreviate suffixes/
// directionals/unit designators (table-driven, see above), Title-Case
// everything else. Non-string / empty input normalizes to ''.
export function normalizeAddress(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const withoutPunctuation = raw.replace(/[,.]/g, ' ');
  const tokens = withoutPunctuation.split(/\s+/).filter(Boolean);
  return tokens.map(normalizeToken).join(' ');
}

export default normalizeAddress;

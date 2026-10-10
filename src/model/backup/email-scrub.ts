// Replaces every email address in a record with a made-up one that can never be delivered
// (web-jam-tools#1083, web-jam-back#1146). Nothing depends on a list of address fields:
// every text value, at any depth, is scanned for anything shaped like an address.

type Doc = Record<string, unknown>;

export const INVALID_DOMAIN = 'example.invalid';

// Something shaped like an address: a local part, an @, and a domain with at least one dot.
const EMAIL_PATTERN = /[\w%+.-]{1,254}@[\dA-Za-z-]{1,63}(?:\.[\dA-Za-z-]{1,63}){1,10}/g;

// An address already made up by this module is left as it is.
function isMadeUp(address: string): boolean {
  return address.toLowerCase().endsWith(`@${INVALID_DOMAIN}`);
}

// Plain objects and arrays are walked; ObjectId, Date, Buffer and the like are values, not containers.
function isPlainObject(value: unknown): value is Doc {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export interface ScrubContext {
  collection: string;
  recordId: string;
  replaced: number;
  // Each distinct original address in one record gets its own made-up one.
  seen: Map<string, string>;
}

export function newScrubContext(collection: string, doc: Doc): ScrubContext {
  return {
    collection,
    recordId: doc._id === undefined ? 'no-id' : String(doc._id),
    replaced: 0,
    seen: new Map(),
  };
}

function madeUpFor(original: string, ctx: ScrubContext): string {
  const key = original.toLowerCase();
  const known = ctx.seen.get(key);
  if (known) return known;
  const n = ctx.seen.size + 1;
  const suffix = n === 1 ? '' : `-${n}`;
  const made = `${ctx.collection}-${ctx.recordId}${suffix}@${INVALID_DOMAIN}`;
  ctx.seen.set(key, made);
  return made;
}

export function scrubString(text: string, ctx: ScrubContext): string {
  return text.replaceAll(EMAIL_PATTERN, (address) => {
    if (isMadeUp(address)) return address;
    ctx.replaced += 1;
    return madeUpFor(address, ctx);
  });
}

export function scrubValue(value: unknown, ctx: ScrubContext): unknown {
  if (typeof value === 'string') return scrubString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, ctx));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, scrubValue(inner, ctx)]));
  }
  return value;
}

export interface ScrubOptions {
  // Keep the record's own top-level `email` as it is (accounts holding the top-level admin role).
  keepEmail?: boolean;
}

export interface ScrubbedDocument {
  doc: Doc;
  replaced: number;
}

export function scrubDocument(doc: Doc, collection: string, opts: ScrubOptions = {}): ScrubbedDocument {
  const ctx = newScrubContext(collection, doc);
  const out: Doc = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] = opts.keepEmail && key === 'email' ? value : scrubValue(value, ctx);
  }
  return { doc: out, replaced: ctx.replaced };
}

// Every real address (lower-cased) found in a value; made-up ones are not real.
export function findRealAddresses(value: unknown): string[] {
  if (typeof value === 'string') {
    return (value.match(EMAIL_PATTERN) || []).filter((a) => !isMadeUp(a)).map((a) => a.toLowerCase());
  }
  if (Array.isArray(value)) return value.flatMap((item) => findRealAddresses(item));
  if (isPlainObject(value)) return Object.values(value).flatMap((inner) => findRealAddresses(inner));
  return [];
}

export default { scrubString, scrubValue, scrubDocument, findRealAddresses };

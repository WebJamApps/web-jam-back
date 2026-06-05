export const CAPABILITIES = [
  // `gig:*` is the new naming; `tour:*` stays valid during the tour->gig rename
  // migration and is removed in the Phase-4 cleanup.
  'gig:create',
  'gig:edit',
  'gig:delete',
  'tour:create',
  'tour:edit',
  'tour:delete',
  'song:create',
  'song:edit',
  'song:delete',
  'book:create',
  'book:edit',
  'book:delete',
  // Gig-promotion channels (Task 5). Assignable to the web-jam-llm bot so
  // Claude/gemma can trigger sends; humans pass via admin role fallback.
  'promo:email',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const capabilitySet: Set<string> = new Set(CAPABILITIES);

export function isValidCapability(value: string): value is Capability {
  return capabilitySet.has(value);
}

export function validatePrivileges(input: unknown): { ok: true; privileges: Capability[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) {
    return { ok: false, message: 'privileges must be an array' };
  }
  for (const entry of input) {
    if (typeof entry !== 'string' || !isValidCapability(entry)) {
      return { ok: false, message: `invalid capability: ${String(entry)}` };
    }
  }
  return { ok: true, privileges: input as Capability[] };
}

export default { CAPABILITIES, isValidCapability, validatePrivileges };

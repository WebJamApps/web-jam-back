// src/lib/email.ts — web-jam-back#974
//
// Shared "is this a plausible email address" check. Same permissive pattern
// already used independently in venue-controller.ts and subscriber-
// controller.ts (requires an @ and a dot in the domain, no whitespace) —
// centralized here so the #974 venue email/secondaryEmail validation and the
// outreach send-path sendability guard (a venue with no VALID primary email
// is not sendable — #974) can't drift from each other.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s.@]+$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_RE.test(value.trim().toLowerCase());
}

export default { EMAIL_RE, isValidEmail };

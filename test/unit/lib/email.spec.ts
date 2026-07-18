import { EMAIL_RE, isValidEmail } from '#src/lib/email.js';

describe('lib/email (#974)', () => {
  describe('isValidEmail', () => {
    it('accepts a well-formed address', () => {
      expect(isValidEmail('booking@spotonkirk.com')).toBe(true);
    });

    it('accepts mixed case (case-insensitivity is a lowercase-before-test concern, not a rejection)', () => {
      expect(isValidEmail('Booking@SpotOnKirk.com')).toBe(true);
    });

    it('rejects a bare word with no @', () => {
      expect(isValidEmail('nope')).toBe(false);
    });

    it('rejects a missing domain dot', () => {
      expect(isValidEmail('nope@nodot')).toBe(false);
    });

    it('rejects whitespace-containing input', () => {
      expect(isValidEmail('not an email@x.com')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('rejects undefined/null/non-string input', () => {
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(42)).toBe(false);
    });
  });

  describe('EMAIL_RE', () => {
    it('is exported for callers that need the raw pattern (e.g. a Mongo $regex query)', () => {
      expect(EMAIL_RE.test('a@b.com')).toBe(true);
      expect(EMAIL_RE.test('bad')).toBe(false);
    });
  });
});

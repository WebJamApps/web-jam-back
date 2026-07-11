// Unit tests for the pure matcher/resolver logic in the #923 migration script.
// Importing the module must NOT touch Mongo (no top-level side effects beyond
// dotenv) — the migration's `run()` only auto-executes when the file is the
// process entry point (see the isMain guard in the source), which is never
// true under vitest.
import {
  isSeptemberVariant, isAugustVariant, resolveWeekend,
} from '#src/scripts/migrate-target-weekend.js';

describe('migrate-target-weekend (#923)', () => {
  describe('isSeptemberVariant', () => {
    it('matches the three known prod variants', () => {
      expect(isSeptemberVariant('Sept 25 to 27')).toBe(true);
      expect(isSeptemberVariant('Sep 25-27')).toBe(true);
      expect(isSeptemberVariant('Friday, September 25 – Sunday, September 27')).toBe(true);
    });

    it('tolerates surrounding whitespace', () => {
      expect(isSeptemberVariant('  Sept 25 to 27  ')).toBe(true);
    });

    it('does not match an unrelated string', () => {
      expect(isSeptemberVariant('the weekend of Aug 14-16')).toBe(false);
      expect(isSeptemberVariant('October 3-5')).toBe(false);
    });
  });

  describe('isAugustVariant', () => {
    it('matches the halted-batch variant (starts with)', () => {
      expect(isAugustVariant('the weekend of Aug 14-16')).toBe(true);
      expect(isAugustVariant('the weekend of Aug 14 to 16, flexible')).toBe(true);
    });

    it('does not match an unrelated string', () => {
      expect(isAugustVariant('Sept 25 to 27')).toBe(false);
    });
  });

  describe('resolveWeekend', () => {
    it('resolves the September variants to 2026-09-25..2026-09-27', () => {
      const w = resolveWeekend('Sep 25-27');
      expect(w).toEqual({ start: new Date('2026-09-25'), end: new Date('2026-09-27') });
    });

    it('resolves the August variant to 2026-08-14..2026-08-16', () => {
      const w = resolveWeekend('the weekend of Aug 14-16');
      expect(w).toEqual({ start: new Date('2026-08-14'), end: new Date('2026-08-16') });
    });

    it('returns null for an unmatched targetDates', () => {
      expect(resolveWeekend('October 3-5')).toBeNull();
    });

    it('returns null for missing/empty targetDates', () => {
      expect(resolveWeekend(undefined)).toBeNull();
      expect(resolveWeekend(null)).toBeNull();
      expect(resolveWeekend('')).toBeNull();
    });
  });
});

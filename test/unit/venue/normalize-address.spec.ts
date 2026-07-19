import {
  normalizeAddress, STREET_SUFFIXES, DIRECTIONALS, UNIT_DESIGNATORS,
} from '#src/model/venue/normalize-address.js';

// web-jam-back#987 — the normalizer table drives POST/PUT /venue's on-write
// normalization and the dedup comparison in findDuplicate. Tested directly,
// independent of the controller.
describe('normalizeAddress (#987)', () => {
  it('non-string / empty input normalizes to an empty string', () => {
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(123 as unknown as string)).toBe('');
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress('   ')).toBe('');
  });

  it('collapses whitespace runs and trims', () => {
    expect(normalizeAddress('  100   Main   Street  ')).toBe('100 Main St');
  });

  it('strips commas and periods', () => {
    expect(normalizeAddress('221 Church St.,')).toBe('221 Church St');
    expect(normalizeAddress('100 N. Main St., Suite 2')).toBe('100 N Main St Ste 2');
  });

  // Every USPS Pub 28 street suffix in the table, individually.
  describe('street suffixes (table-driven)', () => {
    Object.entries(STREET_SUFFIXES).forEach(([word, abbr]) => {
      it(`abbreviates "${word}" -> "${abbr}"`, () => {
        expect(normalizeAddress(`1 Main ${word}`)).toBe(`1 Main ${abbr}`);
        // Case-insensitive on input.
        expect(normalizeAddress(`1 Main ${word.toUpperCase()}`)).toBe(`1 Main ${abbr}`);
      });
    });
  });

  describe('directionals (table-driven)', () => {
    Object.entries(DIRECTIONALS).forEach(([word, abbr]) => {
      it(`abbreviates "${word}" -> "${abbr}"`, () => {
        expect(normalizeAddress(`100 ${word} Main St`)).toBe(`100 ${abbr} Main St`);
      });
    });
  });

  describe('unit designators (table-driven)', () => {
    Object.entries(UNIT_DESIGNATORS).forEach(([word, abbr]) => {
      it(`abbreviates "${word}" -> "${abbr}"`, () => {
        expect(normalizeAddress(`1 Main St ${word} 2`)).toBe(`1 Main St ${abbr} 2`);
      });
    });
  });

  it('applies Title Case to ordinary words', () => {
    expect(normalizeAddress('100 north main street')).toBe('100 N Main St');
    expect(normalizeAddress('100 NORTH MAIN STREET')).toBe('100 N Main St');
  });

  it('leaves a bare "#" (and a "#"-prefixed unit number) untouched — documented choice', () => {
    expect(normalizeAddress('100 Main St # 2')).toBe('100 Main St # 2');
    expect(normalizeAddress('100 Main St #2')).toBe('100 Main St #2');
  });

  it('acceptance example: "100 North Main Street, Suite 2" -> "100 N Main St Ste 2"', () => {
    expect(normalizeAddress('100 North Main Street, Suite 2')).toBe('100 N Main St Ste 2');
  });

  it('acceptance example: "221 Church Street" -> "221 Church St"', () => {
    expect(normalizeAddress('221 Church Street')).toBe('221 Church St');
  });

  it('"1 Electric Road" and "1 Electric Rd" normalize to the same string', () => {
    expect(normalizeAddress('1 Electric Road')).toBe(normalizeAddress('1 Electric Rd'));
    expect(normalizeAddress('1 Electric Road')).toBe('1 Electric Rd');
  });

  it('already-normalized input is a no-op (idempotent)', () => {
    const already = '100 N Main St Ste 2';
    expect(normalizeAddress(already)).toBe(already);
  });

  it('an already-abbreviated compass compound stays correctly cased (idempotent, not "Ne")', () => {
    expect(normalizeAddress('1 NE Main St')).toBe('1 NE Main St');
    expect(normalizeAddress('1 Northeast Main St')).toBe('1 NE Main St');
  });

  it('numbers and non-alphabetic tokens pass through unchanged', () => {
    expect(normalizeAddress('123 Main St')).toBe('123 Main St');
  });
});

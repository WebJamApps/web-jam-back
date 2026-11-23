import { nextTouchDueAfter } from '#src/model/outreach/cadence.js';

const base = new Date('2026-06-01T12:00:00.000Z');

describe('nextTouchDueAfter for legacy outreach records', () => {
  it.each([
    [0, '2026-06-01T12:00:00.000Z'],
    [1, '2026-06-04T12:00:00.000Z'],
    [2, '2026-06-08T12:00:00.000Z'],
    [3, '2026-06-13T12:00:00.000Z'],
    [4, '2026-06-19T12:00:00.000Z'],
    [5, '2026-06-26T12:00:00.000Z'],
  ])('preserves the legacy date at step %i', (step, date) => {
    expect(nextTouchDueAfter(step, base)).toEqual(new Date(date));
  });

  it('returns null after the last step', () => {
    expect(nextTouchDueAfter(6, base)).toBeNull();
  });
});

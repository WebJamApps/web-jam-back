import {
  TOUCHES, PARK_GRACE_DAYS, MAX_STEP, nextTouchDueAfter, touchAt,
} from '#src/model/outreach/cadence.js';

const DAY = 24 * 60 * 60 * 1000;
const base = new Date('2026-06-01T12:00:00.000Z');
const daysAfter = (d: Date) => Math.round((d.getTime() - base.getTime()) / DAY);

describe('cadence', () => {
  it('is the interleaved 5-touch schedule: emails 0/3/12, calls 7/18', () => {
    expect(TOUCHES).toEqual([
      { day: 0, type: 'email' },
      { day: 3, type: 'email' },
      { day: 7, type: 'call' },
      { day: 12, type: 'email' },
      { day: 18, type: 'call' },
    ]);
    expect(MAX_STEP).toBe(5);
    expect(PARK_GRACE_DAYS).toBe(7);
  });

  it('day offsets are strictly increasing so touches fire in order', () => {
    const days = TOUCHES.map((t) => t.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it('touchAt returns the next touch (step = completed count) and null past the end', () => {
    expect(touchAt(1)).toEqual({ day: 3, type: 'email' }); // after the pitch
    expect(touchAt(2)).toEqual({ day: 7, type: 'call' });
    expect(touchAt(4)).toEqual({ day: 18, type: 'call' });
    expect(touchAt(5)).toBeNull();
  });

  it('schedules each touch in turn (step 1->3, 2->7, 3->12, 4->18)', () => {
    expect(daysAfter(nextTouchDueAfter(1, base) as Date)).toBe(3);
    expect(daysAfter(nextTouchDueAfter(2, base) as Date)).toBe(7);
    expect(daysAfter(nextTouchDueAfter(3, base) as Date)).toBe(12);
    expect(daysAfter(nextTouchDueAfter(4, base) as Date)).toBe(18);
  });

  it('schedules a park-check after the final touch (step 5 -> last + grace = day 25)', () => {
    expect(daysAfter(nextTouchDueAfter(5, base) as Date)).toBe(25);
  });

  it('returns null once the park check is past (step beyond the schedule)', () => {
    expect(nextTouchDueAfter(6, base)).toBeNull();
  });
});

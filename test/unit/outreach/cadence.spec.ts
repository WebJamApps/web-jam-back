import {
  EMAIL_TOUCH_DAYS, PARK_GRACE_DAYS, MAX_STEP, nextTouchDueAfter,
} from '#src/model/outreach/cadence.js';

const DAY = 24 * 60 * 60 * 1000;
const base = new Date('2026-06-01T12:00:00.000Z');
const daysAfter = (d: Date) => Math.round((d.getTime() - base.getTime()) / DAY);

describe('cadence', () => {
  it('defaults to the email-only 3-touch schedule', () => {
    expect(EMAIL_TOUCH_DAYS).toEqual([0, 3, 12]);
    expect(MAX_STEP).toBe(3);
    expect(PARK_GRACE_DAYS).toBe(7);
  });

  it('schedules the next email touch after the pitch (step 1 -> day 3)', () => {
    expect(daysAfter(nextTouchDueAfter(1, base) as Date)).toBe(3);
  });

  it('schedules the third touch after the second (step 2 -> day 12)', () => {
    expect(daysAfter(nextTouchDueAfter(2, base) as Date)).toBe(12);
  });

  it('schedules a park-check after the final touch (step 3 -> last + grace = day 19)', () => {
    expect(daysAfter(nextTouchDueAfter(3, base) as Date)).toBe(19);
  });

  it('returns null once the park check is past (step beyond the schedule)', () => {
    expect(nextTouchDueAfter(4, base)).toBeNull();
  });
});

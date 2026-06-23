// Outreach follow-up cadence (web-jam-back#824 email slice + #825 call touches).
// A single interleaved touch schedule, by day-offset from the original pitch
// (`sentAt`). Index 0 is the pitch itself (#823 sendPitch, step 1). EMAIL touches
// go out through the mailer; CALL touches (#825) drop an all-day "call task" onto
// Josh's Google Calendar carrying a phone script, since a call can't be
// auto-dialed. Day offsets are strictly increasing so the cron fires touches in
// order as each `nextTouchDue` comes up.
//
// `step` counts touches already completed (1 = pitch sent), so the NEXT touch is
// always TOUCHES[step]. After the final touch we wait PARK_GRACE_DAYS, then park
// the outreach as `no-response`.
export type TouchType = 'email' | 'call';
export interface Touch { day: number; type: TouchType }

// Research-informed 5-touch sequence: emails day 0/3/12, calls day 7/18.
export const TOUCHES: Touch[] = [
  { day: 0, type: 'email' },
  { day: 3, type: 'email' },
  { day: 7, type: 'call' },
  { day: 12, type: 'email' },
  { day: 18, type: 'call' },
];
export const PARK_GRACE_DAYS = 7;
export const MAX_STEP = TOUCHES.length; // 5

const DAY_MS = 24 * 60 * 60 * 1000;

// The next touch for an outreach whose last completed touch is `step` — i.e.
// TOUCHES[step]. Null once the schedule is exhausted (the remaining work is just
// the park check, which carries no touch).
export function touchAt(step: number): Touch | null {
  return TOUCHES[step] || null;
}

// When should the next action happen for an outreach whose last completed touch
// is `step`? Below the last touch: that touch's date. At the last touch: the
// park-check date (last touch + grace). Beyond that: null.
export function nextTouchDueAfter(step: number, sentAt: Date): Date | null {
  let days: number | null;
  if (step < TOUCHES.length) days = TOUCHES[step].day;
  else if (step === TOUCHES.length) days = TOUCHES[TOUCHES.length - 1].day + PARK_GRACE_DAYS;
  else days = null;
  return days === null ? null : new Date(sentAt.getTime() + days * DAY_MS);
}

export default { TOUCHES, PARK_GRACE_DAYS, MAX_STEP, touchAt, nextTouchDueAfter };

// Email follow-up cadence (web-jam-back#824). Day offsets from the original
// pitch (`sentAt`) at which each EMAIL touch goes out. Index 0 is the pitch
// itself (#823 sendPitch, step 1); follow-ups are day 3 (step 2) and day 12
// (step 3). The research-informed CALL touches (days 7/18) are added with the
// server-side Google Calendar work (#825) — this module is email-only.
//
// `step` counts touches already completed (1 = pitch sent). After the final
// email touch we wait PARK_GRACE_DAYS, then park the outreach as `no-response`.
export const EMAIL_TOUCH_DAYS = [0, 3, 12];
export const PARK_GRACE_DAYS = 7;
export const MAX_STEP = EMAIL_TOUCH_DAYS.length; // 3

const DAY_MS = 24 * 60 * 60 * 1000;

// When should the next action happen for an outreach whose last completed touch
// is `step`? Returns the due Date, or null once everything (incl. the park
// check) is behind us. While `step` is below the last touch it's the next
// email's date; at the last touch it's the park-check date (last touch +
// grace); beyond that it's null.
export function nextTouchDueAfter(step: number, sentAt: Date): Date | null {
  let days: number | null;
  if (step < EMAIL_TOUCH_DAYS.length) days = EMAIL_TOUCH_DAYS[step];
  else if (step === EMAIL_TOUCH_DAYS.length) days = EMAIL_TOUCH_DAYS[EMAIL_TOUCH_DAYS.length - 1] + PARK_GRACE_DAYS;
  else days = null;
  return days === null ? null : new Date(sentAt.getTime() + days * DAY_MS);
}

export default { EMAIL_TOUCH_DAYS, PARK_GRACE_DAYS, MAX_STEP, nextTouchDueAfter };

// Reopen preserves the next-touch date that a historical step used to carry.
// The offsets include the original pitch at day 0 and the final wait through day 25.
const LEGACY_TOUCH_DAY_OFFSETS: readonly number[] = [0, 3, 7, 12, 18, 25];
const DAY_MS = 24 * 60 * 60 * 1000;

export function nextTouchDueAfter(step: number, sentAt: Date): Date | null {
  const days = LEGACY_TOUCH_DAY_OFFSETS[step];
  return days === undefined ? null : new Date(sentAt.getTime() + days * DAY_MS);
}

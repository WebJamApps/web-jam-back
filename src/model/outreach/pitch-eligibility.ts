export const PITCH_COOLDOWN_DAYS = 7;

export interface PitchRecord {
  venueId?: unknown;
  status?: string;
  sentAt?: unknown;
  created_at?: unknown;
}

export interface PitchEligibility {
  open: boolean;
  firstPitchAt: number | null;
  lastPitchAt: number | null;
  reason?: string;
}

export function timestamp(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

// One policy for discovery, single sends, and batch dispatch. Unknown history
// never establishes silence. The seven-day edge is deliberately exclusive.
export function pitchEligibility(records: PitchRecord[], now = Date.now()): PitchEligibility {
  const dates = records.map((record) => timestamp(record.sentAt ?? record.created_at));
  const validDates = dates.filter((date): date is number => date !== null);
  const state: PitchEligibility = {
    open: false,
    firstPitchAt: validDates.length ? Math.min(...validDates) : null,
    lastPitchAt: validDates.length ? Math.max(...validDates) : null,
  };
  if (records.length === 0) return { ...state, open: true };
  if (records.some((record) => ['booked', 'target-filled'].includes(record.status || ''))) {
    return {
      ...state,
      reason: 'this venue is already booked or target-filled for an overlapping target weekend; '
        + 'reopen that record on the admin outreach screen to pitch it again',
    };
  }
  if (records.some((record) => !['sent', 'no-response'].includes(record.status || ''))) {
    return { ...state, reason: 'this venue has a reply or an unresolved outreach status for this target weekend' };
  }
  if (validDates.length !== records.length) return { ...state, reason: 'the last pitch date could not be verified' };
  if (records.length >= 2) return { ...state, reason: 'a first and second pitch have already been sent for this target weekend' };
  if (state.lastPitchAt === null || state.lastPitchAt >= now - PITCH_COOLDOWN_DAYS * 86400000) {
    return {
      ...state,
      reason: 'an active outreach already exists for this venue and an overlapping target weekend; '
        + 'more than seven days of silence are required',
    };
  }
  return { ...state, open: true };
}

export function venueApprovalTime(approval: Record<string, unknown>, venueId: string): number | null {
  if (!Array.isArray(approval.venueApprovals)) return null;
  const entries = approval.venueApprovals.filter(
    (entry: { venueId?: unknown } | null) => entry && String(entry.venueId).toLowerCase() === venueId.toLowerCase(),
  );
  return entries.length === 1 ? timestamp(entries[0].approvedAt) : null;
}

export function dueFromApproval(state: PitchEligibility, approvedAt: unknown): boolean {
  if (!state.open) return false;
  if (state.lastPitchAt === null) return true;
  const time = timestamp(approvedAt);
  return time !== null && time > state.lastPitchAt;
}

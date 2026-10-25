import {
  pitchEligibility, dueFromApproval, venueApprovalTime, timestamp,
} from '#src/model/outreach/pitch-eligibility.js';
import { preserveVenueApprovalTimes } from '#src/model/outreach/outreach-venue-approval-facade.js';

const now = Date.parse('2026-11-01T12:00:00Z');
const day = 86400000;
const old = new Date(now - 8 * day);

describe('one open-to-a-pitch policy', () => {
  it('opens a venue with no history', () => {
    expect(pitchEligibility([], now)).toMatchObject({ open: true, firstPitchAt: null, lastPitchAt: null });
  });

  it.each(['sent', 'no-response'])('opens %s only strictly beyond seven days', (status) => {
    for (const [age, open] of [[7 * day - 1, false], [7 * day, false], [7 * day + 1, true]] as const) {
      expect(pitchEligibility([{ status, sentAt: new Date(now - age) }], now).open).toBe(open);
    }
  });

  it.each(['replied', 'interested', 'not-interested', 'booked', 'target-filled', 'draft', 'failed', undefined])(
    'keeps %s closed at any age, even alongside a silent record', (status) => {
      expect(pitchEligibility([{ status, sentAt: old }, { status: 'sent', sentAt: old }], now).open).toBe(false);
    },
  );

  it('allows at most the initial pitch and one second pitch', () => {
    const state = pitchEligibility([
      { status: 'sent', sentAt: new Date(now - 20 * day) }, { status: 'no-response', sentAt: old },
    ], now);
    expect(state).toMatchObject({ open: false, firstPitchAt: now - 20 * day, lastPitchAt: old.getTime() });
  });

  it('falls back to the legacy creation time but refuses missing or invalid dates', () => {
    expect(pitchEligibility([{ status: 'sent', created_at: old }], now).open).toBe(true);
    expect(pitchEligibility([{ status: 'sent' }], now).open).toBe(false);
    expect(pitchEligibility([{ status: 'sent', sentAt: 'bad', created_at: old }], now).open).toBe(false);
    expect(timestamp({})).toBeNull();
  });

  it('requires a renewed approval strictly after the latest pitch, in addition to silence', () => {
    const state = pitchEligibility([{ status: 'sent', sentAt: old }], now);
    expect(dueFromApproval(state, null)).toBe(false);
    expect(dueFromApproval(state, old)).toBe(false);
    expect(dueFromApproval(state, old.getTime() - 1)).toBe(false);
    expect(dueFromApproval(state, old.getTime() + 1)).toBe(true);
    expect(dueFromApproval(pitchEligibility([{ status: 'sent', sentAt: now }], now), now + 1)).toBe(false);
    expect(dueFromApproval(pitchEligibility([], now), null)).toBe(true);
  });
});

describe('per-venue Gate 1 times', () => {
  const existing = { venueIds: ['a', 'b'], venueApprovals: [{ venueId: 'a', approvedAt: old }, { venueId: 'b', approvedAt: old }] };
  it('preserves carried times on widening and stamps only new or explicitly renewed venues', () => {
    expect(preserveVenueApprovalTimes(['a', 'b', 'c'], existing, ['b'], new Date(now))).toEqual([
      { venueId: 'a', approvedAt: old }, { venueId: 'b', approvedAt: new Date(now) }, { venueId: 'c', approvedAt: new Date(now) },
    ]);
    expect(preserveVenueApprovalTimes(['a', 'b'], existing, [], new Date(now))).toEqual(existing.venueApprovals);
  });

  it('cannot remove carried venues or repair an unreadable stored set by replacing it', () => {
    expect(() => preserveVenueApprovalTimes(['c'], existing, [], new Date(now))).toThrow('only be widened');
    expect(() => preserveVenueApprovalTimes(['c'], {}, [], new Date(now))).toThrow('cannot read');
  });

  it('does not manufacture carried timestamps from a legacy global approval date', () => {
    const legacy = { venueIds: ['a'], approvedAt: old };
    expect(preserveVenueApprovalTimes(['a', 'b'], legacy, [], new Date(now))).toEqual([{ venueId: 'b', approvedAt: new Date(now) }]);
    expect(preserveVenueApprovalTimes(['a'], legacy, ['a'], new Date(now))).toEqual([{ venueId: 'a', approvedAt: new Date(now) }]);
    expect(preserveVenueApprovalTimes(['a'], null, [], new Date(now))).toEqual([{ venueId: 'a', approvedAt: new Date(now) }]);
  });

  it('fails closed on missing, malformed or ambiguous per-venue dates', () => {
    expect(venueApprovalTime({ approvedAt: old }, 'a')).toBeNull();
    expect(venueApprovalTime({ venueApprovals: [{ venueId: 'a', approvedAt: 'bad' }] }, 'a')).toBeNull();
    expect(venueApprovalTime({ venueApprovals: [null, { venueId: 'A', approvedAt: old }] }, 'a')).toBe(old.getTime());
    expect(venueApprovalTime({ venueApprovals: [{ venueId: 'a', approvedAt: old }, { venueId: 'a', approvedAt: old }] }, 'a')).toBeNull();
  });
});

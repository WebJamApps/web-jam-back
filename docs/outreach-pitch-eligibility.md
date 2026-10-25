# Pitch eligibility and Gate 1 renewals

For a structured `targetWeekend`, candidates, single sends and batch sends use
the same policy. A venue with no overlapping outreach is open. Otherwise all
records must be `sent` or `no-response`, and the newest pitch must be strictly
more than seven days old. Any reply or other outcome closes that weekend.
`booked` and `target-filled` retain the existing Reopen workflow. At most the
initial pitch and one second pitch may be sent for a weekend. Other weekends
do not block it.

`GET /outreach/candidates` adds `lastPitchDate` to each candidate: the latest
pitch time for the requested weekend, as an ISO timestamp, or `null` if never
pitched. Both singular and plural `GET /outreach/preview` accept
`targetWeekend` as an ISO date range string, for example
`2026-11-20 to 2026-11-22`, alongside display-only `targetDates`. An ISO range
in `targetDates` also remains supported. Previews and sends choose the venue type's
`second-pitch` template when history exists and fill `[First Pitch Date]` from
the earliest pitch for that weekend. Missing second-pitch templates refuse the
venue; there is no cold-template fallback.

## Recording Gate 1

`POST /outreach/approval/venue-set` (also `/outreach/approval/gate1`) still takes
the complete approved `venueIds` set. An existing set can be widened, but cannot
silently drop carried venues. Each record now includes
`venueApprovals: [{ venueId, approvedAt }]`.

- New venues receive the current approval time.
- Carried venues keep their previous approval time.
- The optional `reapproveVenueIds` array explicitly names carried venues being
  approved again. It must be a unique subset of the complete `venueIds` set.
  Only named venues have their approval time renewed.
- Legacy approvals without per-venue times can still authorize a first pitch.
  They cannot authorize a second pitch until that venue is explicitly renewed.
  The record's global `approvedAt` does not establish a per-venue renewal.

For example, widening `[a, b]` to `[a, b, c]` with
`reapproveVenueIds: [b]` preserves `a`'s time and stamps `b` and `c` now.

## Checking and sending a batch

A venue is due from Gate 1 only if it is open and either has never been pitched
or its per-venue approval time is strictly after its latest pitch. The whole
batch must exactly equal the approved venues currently due, and Gate 2 must
cover that same set with fingerprints of the rendered subject and body.
Carried venues that are no longer due are excluded from both comparisons.

Dispatch stores the checked set and approval versions. Each call checks them
again, then reuses the verified email bytes while checking eligibility and the
per-venue approval immediately before each send. A pending venue that is no
longer due is reported as skipped and marked attempted once. Retrying after
another week cannot send it again using the old approval.

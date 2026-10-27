import type { Request, Response } from 'express';
import mongoose from 'mongoose';

const sendMail = vi.fn((_options: unknown) => Promise.resolve({ messageId: 'test-pitch' }));
vi.mock('#src/lib/mailer.js', () => ({ sendMail, default: { sendMail } }));
const { default: controller, computeDraftFingerprint } = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: outreachModel } = await import('#src/model/outreach/outreach-facade.js');
const { default: venueApproval } = await import('#src/model/outreach/outreach-venue-approval-facade.js');
const { default: venueApprovalSchema } = await import('#src/model/outreach/outreach-venue-approval-schema.js');
const { default: draftApproval } = await import('#src/model/outreach/outreach-draft-approval-facade.js');
const { default: dispatchModel } = await import('#src/model/outreach/outreach-dispatch-facade.js');
const { default: dispatchSchema } = await import('#src/model/outreach/outreach-dispatch-schema.js');
const { default: gigModel } = await import('#src/model/gig/gig-facade.js');

type Action = (req: Request & { user?: string }, res: Response) => Promise<unknown>;
const c = controller as unknown as {
  getCandidates: Action; sendPitch: Action; sendBatch: Action; preflightBatch: Action;
  previewByVenue: Action; recordVenueApproval: Action;
};
const oid = () => new mongoose.Types.ObjectId().toString();
const now = Date.parse('2026-11-01T12:00:00Z');
const day = 86400000;
let old = new Date(now - 8 * day);
const weekend = { start: '2026-11-20', end: '2026-11-22' };
const baseBody = { batchId: 'november', targetDates: 'November 20–22', targetWeekend: weekend };
const coldTemplate = {
  type: 'Originals', stage: 'cold', subject: 'Inquiry: [Venue Name]',
  bodyHtml: '<p>Booking for [Target Dates].</p>', footerPhotoRef: 'footer-josh-maria',
};
const secondTemplate = {
  ...coldTemplate, stage: 'second-pitch', subject: 'Following up: [Venue Name]',
  bodyHtml: '<p>Following up on my note from [First Pitch Date] about [Target Dates].</p>',
};

async function invoke(action: Action, body: Record<string, unknown> = {}, query = {}) {
  let status = 0;
  let payload: unknown;
  const res = {
    status: (code: number) => { status = code; return res; },
    json: (data: unknown) => { payload = data; return res; },
  } as unknown as Response;
  await action.call(c, { user: oid(), body, query } as unknown as Request, res);
  return { status, payload: payload as Record<string, unknown> };
}

function setup(count = 1) {
  const venues = Array.from({ length: count }, (_, index) => ({
    _id: oid(), name: `Venue ${index}`, email: 'booking@example.com', venueType: 'Originals', status: 'active', outreachEligible: true,
  }));
  const ids = venues.map((venue) => venue._id);
  const records: Record<string, unknown>[] = [];
  const gate1 = {
    _id: oid(), batchId: baseBody.batchId, venueIds: ids, updated_at: new Date(now),
    venueApprovals: ids.map((venueId) => ({ venueId, approvedAt: new Date(now) })),
  };
  const gate2 = {
    _id: oid(), batchId: baseBody.batchId, updated_at: new Date(now),
    draftFingerprints: [] as { venueId: string; fingerprint: string }[],
  };
  let dispatch: Record<string, unknown> = {};
  vi.spyOn(userModel, 'findById').mockResolvedValue({ privileges: ['outreach:approve'] });
  vi.spyOn(venueModel, 'find').mockResolvedValue(venues);
  vi.spyOn(venueModel, 'findById').mockImplementation(async (id) => venues.find((venue) => venue._id === id) || null);
  vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
  vi.spyOn(gigModel, 'find').mockResolvedValue([]);
  vi.spyOn(gigModel, 'findOne').mockResolvedValue(null);
  vi.spyOn(templateModel, 'findOne').mockImplementation(async (query) => (query.stage === 'second-pitch' ? secondTemplate : coldTemplate));
  vi.spyOn(outreachModel, 'find').mockImplementation(async () => records);
  vi.spyOn(outreachModel, 'create').mockImplementation(async (doc) => {
    const record = { _id: oid(), ...doc };
    records.push(record);
    return record as Awaited<ReturnType<typeof outreachModel.create>>;
  });
  vi.spyOn(venueApproval, 'findOne').mockResolvedValue(gate1);
  vi.spyOn(venueApproval, 'findByIdAndUpdate').mockImplementation(async (_id, doc) => {
    Object.assign(gate1, doc);
    return gate1;
  });
  vi.spyOn(draftApproval, 'findOne').mockResolvedValue(gate2);
  vi.spyOn(dispatchModel, 'create').mockImplementation(async (doc) => {
    dispatch = new dispatchSchema(doc).toObject() as Record<string, unknown>;
    return dispatch as Awaited<ReturnType<typeof dispatchModel.create>>;
  });
  vi.spyOn(dispatchModel, 'findOne').mockImplementation(async () => dispatch);
  vi.spyOn(dispatchModel, 'findOneAndUpdate').mockImplementation(async (_query, update) => {
    Object.assign(dispatch, update.$set);
    const attempted = update.$addToSet?.attemptedVenueIds;
    if (attempted) {
      const added = typeof attempted === 'string' ? [attempted] : attempted.$each;
      dispatch.attemptedVenueIds = [...new Set([...(dispatch.attemptedVenueIds as string[] || []), ...added])];
    }
    return dispatch;
  });
  return { venues, ids, records, gate1, gate2, getDispatch: () => dispatch };
}

async function approveCopies(fixture: ReturnType<typeof setup>, ids = fixture.ids) {
  for (const venueId of ids) {
    const result = await invoke(c.previewByVenue, {}, { ...baseBody, venueId });
    expect(result.status).toBe(200);
    fixture.gate2.draftFingerprints.push({
      venueId, fingerprint: computeDraftFingerprint({ subject: String(result.payload.subject), body: String(result.payload.html) }),
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.setSystemTime(now);
  old = new Date(now - 8 * day);
  sendMail.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('candidates, single pitches and batches share the weekend policy (#1170)', () => {
  it.each([
    ['sent', 8, true], ['no-response', 8, true], ['sent', 7, false], ['sent', 6, false],
    ['replied', 90, false], ['interested', 90, false], ['not-interested', 90, false], ['booked', 90, false], ['target-filled', 90, false],
  ])('applies %s at %s days to all three callers', async (status, days, open) => {
    const f = setup();
    f.records.push({ venueId: f.ids[0], status, sentAt: new Date(now - days * day) });
    const candidates = await invoke(c.getCandidates, {}, { targetWeekend: weekend });
    expect(candidates.status).toBe(200);
    expect(candidates.payload.candidates).toHaveLength(open ? 1 : 0);
    await approveCopies(f);
    const batch = await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids });
    expect(batch.status).toBe(open ? 200 : 403);
    expect(sendMail).not.toHaveBeenCalled();
    const single = await invoke(c.sendPitch, { ...baseBody, venueId: f.ids[0] });
    expect(single.status).toBe(open ? 201 : 409);
    expect(sendMail).toHaveBeenCalledTimes(open ? 1 : 0);
  });

  it('serves the most recent pitch date and null for never-pitched venues', async () => {
    const f = setup(2);
    f.records.push({ venueId: f.ids[0].toUpperCase(), status: 'no-response', sentAt: old });
    const result = await invoke(c.getCandidates, {}, { targetWeekend: weekend });
    expect(result.payload.candidates).toEqual([
      expect.objectContaining({ _id: f.ids[0], lastPitchDate: old.toISOString() }),
      expect.objectContaining({ _id: f.ids[1], lastPitchDate: null }),
    ]);
    const query = vi.mocked(outreachModel.find).mock.calls[0][0];
    expect(query).toMatchObject({
      venueId: { $in: f.ids },
      'targetWeekend.start': { $exists: true, $lte: new Date(weekend.end) },
      'targetWeekend.end': { $exists: true, $gte: new Date(weekend.start) },
    });
    expect(query).not.toHaveProperty('status');
  });

  it.each([false, true])('sends exactly the second-pitch preview after Gate 2 (direct batch: %s)', async (direct) => {
    const f = setup();
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old });
    await approveCopies(f);
    const preview = await invoke(c.previewByVenue, {}, { ...baseBody, venueId: f.ids[0] });
    expect(preview.payload.html).toContain('October 24');
    expect(preview.payload.html).not.toContain('[First Pitch Date]');
    expect(preview.payload.subject).toContain('Following up');
    const batchPreview = await invoke(c.previewByVenue, {}, { ...baseBody, venueIds: f.ids.join(',') });
    expect(batchPreview.payload).toEqual([expect.objectContaining({ subject: preview.payload.subject, body: preview.payload.html })]);
    const body = { ...baseBody, venueIds: f.ids };
    const preflight = direct ? null : await invoke(c.preflightBatch, body);
    const result = await invoke(c.sendBatch, direct ? body : { dispatchId: preflight?.payload.dispatchId });
    expect(result.status).toBe(200);
    expect(result.payload.sent).toBe(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: preview.payload.subject, html: preview.payload.html }));
    expect(templateModel.findOne).toHaveBeenCalledWith({ type: 'Originals', active: true, stage: 'second-pitch' });
  });

  it('uses a query-string weekend independently of the preview display dates', async () => {
    const f = setup();
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old });
    const result = await invoke(c.previewByVenue, {}, {
      venueId: f.ids[0], targetWeekend: '2026-11-20 to 2026-11-22', targetDates: 'our November weekend',
    });
    expect(result.status).toBe(200);
    expect(result.payload.subject).toContain('Following up');
    expect(result.payload.html).toContain('October 24');
    expect(result.payload.html).toContain('our November weekend');
  });

  it('refuses second pitches without a type-specific second-pitch template', async () => {
    const f = setup();
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old });
    vi.mocked(templateModel.findOne).mockImplementation(async (query) => (query.stage === 'second-pitch' ? null : coldTemplate));
    const result = await invoke(c.sendPitch, { ...baseBody, venueId: f.ids[0] });
    expect(result.status).toBe(400);
    expect(result.payload.message).toContain('no active second-pitch template');
    expect(sendMail).not.toHaveBeenCalled();
    expect(templateModel.findOne).toHaveBeenCalledTimes(1);
  });

  it('never sends a third pitch for the same weekend', async () => {
    const f = setup();
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: new Date(now - 20 * day) }, { venueId: f.ids[0], status: 'no-response', sentAt: old });
    const result = await invoke(c.sendPitch, { ...baseBody, venueId: f.ids[0] });
    expect(result.status).toBe(409);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('fails closed for all callers when the history lookup fails', async () => {
    const f = setup();
    vi.mocked(outreachModel.find).mockRejectedValue(new Error('history unavailable'));
    for (const [action, body, query] of [
      [c.getCandidates, {}, { targetWeekend: weekend }],
      [c.sendPitch, { ...baseBody, venueId: f.ids[0] }, {}],
      [c.preflightBatch, { ...baseBody, venueIds: f.ids }, {}],
    ] as const) {
      const result = await invoke(action, body, query);
      expect(result.status).toBe(500);
      expect(result.payload.message).toContain('history unavailable');
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(dispatchModel.create).not.toHaveBeenCalled();
  });
});

describe('batches send only venues due from the per-venue approval', () => {
  it('widening renews only named venues and survives the schema round trip', async () => {
    const f = setup(2);
    f.gate1.venueApprovals.forEach((entry) => { entry.approvedAt = old; });
    const added = oid();
    const result = await invoke(c.recordVenueApproval, { ...baseBody, venueIds: [...f.ids, added], reapproveVenueIds: [f.ids[1]] });
    expect(result.status).toBe(200);
    const saved = new venueApprovalSchema(result.payload).toObject() as { venueApprovals?: { venueId: unknown; approvedAt: Date }[] };
    expect(saved.venueApprovals?.map((entry) => ({ venueId: String(entry.venueId), approvedAt: entry.approvedAt }))).toEqual([
      { venueId: f.ids[0], approvedAt: old }, { venueId: f.ids[1], approvedAt: new Date(now) }, { venueId: added, approvedAt: new Date(now) },
    ]);
  });

  it.each(['foreign-id', 'null-entry', 'duplicate', 'not-an-array'])('rejects malformed explicit renewals: %s', async (kind) => {
    const f = setup();
    const invalid: Record<string, unknown> = {
      'foreign-id': [oid()], 'null-entry': [null], duplicate: [f.ids[0], f.ids[0]], 'not-an-array': 'bad',
    };
    const result = await invoke(c.recordVenueApproval, { ...baseBody, venueIds: f.ids, reapproveVenueIds: invalid[kind] });
    expect(result.status).toBe(400);
    expect(venueApproval.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to replace an approved weekend set with a smaller set', async () => {
    const f = setup(2);
    const result = await invoke(c.recordVenueApproval, { ...baseBody, venueIds: [f.ids[0]] });
    expect(result.status).toBe(400);
    expect(venueApproval.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('a widened batch includes exactly new and explicitly renewed venues, even weeks later', async () => {
    const f = setup(3);
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old }, { venueId: f.ids[1], status: 'sent', sentAt: old });
    f.gate1.venueApprovals[0].approvedAt = new Date(now - 9 * day);
    await approveCopies(f);
    for (const venueIds of [[f.ids[1]], f.ids]) {
      expect((await invoke(c.preflightBatch, { ...baseBody, venueIds })).status).toBe(403);
    }
    const preflight = await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids.slice(1) });
    expect(preflight.status).toBe(200);
    const result = await invoke(c.sendBatch, { dispatchId: preflight.payload.dispatchId });
    expect(result.payload.sent).toBe(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('an approval without per-venue times cannot authorize a second pitch', async () => {
    const f = setup(2);
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old });
    f.gate1.venueApprovals = [];
    await approveCopies(f);
    expect((await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids })).status).toBe(403);
    expect((await invoke(c.preflightBatch, { ...baseBody, venueIds: [f.ids[1]] })).status).toBe(200);
  });

  it('checks Gate 2 against precisely the due set', async () => {
    const f = setup(2);
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: old });
    await approveCopies(f, [f.ids[1]]);
    const result = await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids });
    expect(result.status).toBe(403);
    expect(result.payload.message).toContain('Gate 2');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips a venue pitched after preflight, once, even when retried beyond seven days', async () => {
    const f = setup(2);
    await approveCopies(f);
    const preflight = await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids });
    expect(preflight.status).toBe(200);
    f.records.push({ venueId: f.ids[0], status: 'sent', sentAt: new Date(now + 1) });
    vi.setSystemTime(now + 15 * day);
    const body = { dispatchId: preflight.payload.dispatchId };
    const result = await invoke(c.sendBatch, body);
    expect(result.status).toBe(200);
    expect(result.payload).toMatchObject({ sent: 1, remaining: 0, skipped: [expect.objectContaining({ venueId: f.ids[0] })] });
    expect(f.getDispatch().attemptedVenueIds).toEqual(expect.arrayContaining(f.ids));
    expect((await invoke(c.sendBatch, body)).payload).toMatchObject({ sent: 0, skipped: [], remaining: 0 });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('rechecks status immediately before each send even after verifying copy', async () => {
    const f = setup();
    await approveCopies(f);
    const preflight = await invoke(c.preflightBatch, { ...baseBody, venueIds: f.ids });
    // Send-call snapshot and render pass still see silence; the final send guard sees the answer.
    vi.mocked(outreachModel.find).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValue([{ venueId: f.ids[0], status: 'replied', sentAt: old }]);
    const result = await invoke(c.sendBatch, { dispatchId: preflight.payload.dispatchId });
    expect(result.payload.sent).toBe(0);
    expect(result.payload.skipped).toHaveLength(1);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

import type { Request, Response } from 'express';
import mongoose from 'mongoose';

const sendMail = vi.fn((_options: unknown) => Promise.resolve({ messageId: 'test-message' }));
vi.mock('#src/lib/mailer.js', () => ({ sendMail, default: { sendMail } }));

const { default: controller, computeDraftFingerprint } = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: venueApproval } = await import('#src/model/outreach/outreach-venue-approval-facade.js');
const { default: draftApproval } = await import('#src/model/outreach/outreach-draft-approval-facade.js');
const { default: dispatchModel } = await import('#src/model/outreach/outreach-dispatch-facade.js');
const { default: dispatchSchema } = await import('#src/model/outreach/outreach-dispatch-schema.js');
const { default: outreachModel } = await import('#src/model/outreach/outreach-facade.js');
const { default: gigModel } = await import('#src/model/gig/gig-facade.js');

type Action = (req: Request & { user?: string }, res: Response) => Promise<unknown>;
const c = controller as unknown as { previewByVenue: Action; preflightBatch: Action; sendBatch: Action };
const oid = () => new mongoose.Types.ObjectId().toString();
const weekend = { start: '2026-10-16', end: '2026-10-18' };
const baseBody = { batchId: 'mixed', targetWeekend: weekend, targetDates: 'Oct 16-18', templateType: 'Originals' };
const template = {
  type: 'Originals', stage: 'cold', subject: 'Inquiry: [Venue Name]',
  introHtml: '<p>Hi [Contact Name],</p><p>Default opener.</p>',
  bodyHtml: '<p>Booking for [Target Dates].</p>\n[Custom Body]', footerPhotoRef: 'footer-josh-maria',
};

async function invoke(action: Action, body = {}, query = {}) {
  let status = 0;
  let payload: unknown;
  const res = {
    status: vi.fn((code: number) => { status = code; return res; }),
    json: vi.fn((data: unknown) => { payload = data; return res; }),
  } as unknown as Response;
  await action.call(c, { user: oid(), body, query } as unknown as Request, res);
  return { status, payload: payload as Record<string, unknown> };
}

function setup() {
  const venues = ['Call Brewery', 'Visit Tavern', 'Standard Venue', 'Tweaked Venue'].map((name) => ({
    _id: oid(), name, contactName: 'Pat', email: 'booking@example.com', venueType: 'Originals', status: 'active', outreachEligible: true,
  }));
  const venueIds = venues.map((v) => v._id);
  const venueCustomizations = [
    { venueId: venueIds[0], customIntro: 'Hi Pat,\n\nFollowing up on our phone conversation.' },
    { venueId: venueIds[1], customIntro: "Hi Pat,\n\nFollowing up on connecting in person at Mac & Bob's." },
    { venueId: venueIds[3], customBody: 'My son lives nearby.' },
  ];
  const gate1 = { _id: oid(), batchId: 'mixed', venueIds, updated_at: new Date('2026-10-01') };
  const gate2 = {
    _id: oid(), batchId: 'mixed', updated_at: gate1.updated_at,
    draftFingerprints: [] as { venueId: string; fingerprint: string }[],
  };
  let dispatch: Record<string, unknown> | null = null;
  vi.spyOn(userModel, 'findById').mockResolvedValue({ privileges: ['outreach:approve'] });
  vi.spyOn(venueModel, 'findById').mockImplementation(async (id) => venues.find((v) => v._id === id) || null);
  vi.spyOn(venueModel, 'find').mockResolvedValue(venues);
  vi.spyOn(venueModel, 'findByIdAndUpdate').mockResolvedValue({});
  vi.spyOn(templateModel, 'find').mockResolvedValue([template]);
  vi.spyOn(templateModel, 'findOne').mockResolvedValue(template);
  vi.spyOn(gigModel, 'find').mockResolvedValue([]);
  vi.spyOn(gigModel, 'findOne').mockResolvedValue(null);
  vi.spyOn(outreachModel, 'find').mockResolvedValue([]);
  vi.spyOn(outreachModel, 'findOne').mockResolvedValue(null);
  vi.spyOn(outreachModel, 'create').mockImplementation(async (doc) => ({ _id: oid(), ...doc }) as Awaited<ReturnType<typeof outreachModel.create>>);
  vi.spyOn(venueApproval, 'findOne').mockResolvedValue(gate1);
  vi.spyOn(draftApproval, 'findOne').mockResolvedValue(gate2);
  vi.spyOn(dispatchModel, 'create').mockImplementation(async (doc) => {
    // Round-trip through the real schema: an unregistered path must not silently disappear.
    dispatch = new dispatchSchema(doc).toObject() as Record<string, unknown>;
    return dispatch as Awaited<ReturnType<typeof dispatchModel.create>>;
  });
  vi.spyOn(dispatchModel, 'findOne').mockImplementation(async () => dispatch);
  vi.spyOn(dispatchModel, 'findOneAndUpdate').mockResolvedValue({});
  return { venues, venueIds, venueCustomizations, gate2, getDispatch: () => dispatch };
}

async function approvePreviews(fixture: ReturnType<typeof setup>) {
  const previews = new Map<string, { subject: string; body: string }>();
  for (const venueId of fixture.venueIds) {
    const slots = fixture.venueCustomizations.find((entry) => entry.venueId === venueId);
    const result = await invoke(c.previewByVenue, {}, { ...baseBody, venueIds: venueId, ...slots });
    expect(result.status).toBe(200);
    const [preview] = result.payload as unknown as { subject: string; body: string }[];
    previews.set(venueId, preview);
    fixture.gate2.draftFingerprints.push({ venueId, fingerprint: computeDraftFingerprint(preview) });
  }
  return previews;
}

beforeEach(() => {
  vi.restoreAllMocks();
  sendMail.mockClear();
});

describe('whole-batch preflight with per-venue custom slots', () => {
  it.each([false, true])('persists every slot and sends the exact approved preview (legacy direct batch: %s)', async (legacy) => {
    const fixture = setup();
    const previews = await approvePreviews(fixture);
    const body = { ...baseBody, venueIds: fixture.venueIds, venueCustomizations: fixture.venueCustomizations };
    let send: Awaited<ReturnType<typeof invoke>>;
    if (!legacy) {
      const preflight = await invoke(c.preflightBatch, body);
      expect(preflight.status).toBe(200);
      expect(sendMail).not.toHaveBeenCalled();
      expect(fixture.getDispatch()?.venueCustomizations).toEqual(fixture.venueCustomizations);
      // A send request cannot replace the inputs that passed preflight.
      send = await invoke(c.sendBatch, {
        dispatchId: preflight.payload.dispatchId,
        venueCustomizations: [{ venueId: fixture.venueIds[0], customIntro: 'INJECTED' }],
      });
    } else {
      send = await invoke(c.sendBatch, body);
    }
    expect(send.status).toBe(200);
    expect(send.payload.sent).toBe(4);
    expect(sendMail).toHaveBeenCalledTimes(4);
    for (const [index, venueId] of fixture.venueIds.entries()) {
      const mail = sendMail.mock.calls[index][0] as unknown as { subject: string; html: string };
      expect(mail.subject).toBe(previews.get(venueId)?.subject);
      expect(mail.html).toBe(previews.get(venueId)?.body);
    }
  });

  it.each(['subset', 'missing-intro', 'changed-body'])('refuses the whole batch before any send on %s', async (mutation) => {
    const fixture = setup();
    await approvePreviews(fixture);
    const body = { ...baseBody, venueIds: fixture.venueIds, venueCustomizations: fixture.venueCustomizations };
    if (mutation === 'subset') body.venueIds = body.venueIds.slice(0, 1);
    if (mutation === 'missing-intro') body.venueCustomizations = body.venueCustomizations.slice(1);
    if (mutation === 'changed-body') body.venueCustomizations[2].customBody = 'Changed after approval.';
    // Keep the subset case focused on the exact-set guard, with valid customizations for its subset.
    body.venueCustomizations = body.venueCustomizations.filter((entry) => body.venueIds.includes(entry.venueId));
    const preflight = await invoke(c.preflightBatch, body);
    expect(preflight.status).toBe(403);
    expect(preflight.payload.message).toContain(mutation === 'subset' ? 'venue-set approval' : 'fingerprint mismatch');
    expect(dispatchModel.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rechecks the persisted custom text against Gate 2 before any send', async () => {
    const fixture = setup();
    await approvePreviews(fixture);
    const preflight = await invoke(c.preflightBatch, {
      ...baseBody, venueIds: fixture.venueIds, venueCustomizations: fixture.venueCustomizations,
    });
    expect(preflight.status).toBe(200);
    const stored = fixture.getDispatch()!.venueCustomizations as typeof fixture.venueCustomizations;
    stored[2].customBody = 'Changed in storage.';
    const send = await invoke(c.sendBatch, { dispatchId: preflight.payload.dispatchId });
    expect(send.status).toBe(403);
    expect(send.payload.message).toContain('fingerprint mismatch');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each(['not-array', 'null-entry', 'foreign-id', 'duplicate', 'non-string'])('rejects malformed customizations: %s', async (kind) => {
    const fixture = setup();
    const first = fixture.venueCustomizations[0];
    const invalid: Record<string, unknown> = {
      'not-array': {}, 'null-entry': [null], 'foreign-id': [{ ...first, venueId: oid() }],
      duplicate: [first, first], 'non-string': [{ ...first, customBody: 123 }],
    };
    const result = await invoke(c.preflightBatch, { ...baseBody, venueIds: fixture.venueIds, venueCustomizations: invalid[kind] });
    expect(result.status).toBe(400);
    expect(result.payload.message).toContain('venueCustomizations');
    expect(dispatchModel.create).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});

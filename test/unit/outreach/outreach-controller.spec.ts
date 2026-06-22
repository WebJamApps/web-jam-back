/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';

const sendMail = vi.fn(() => Promise.resolve({ messageId: 'mid-123' }));
vi.mock('#src/lib/mailer.js', () => ({
  sendMail,
  default: { sendMail },
}));

const { default: controller } = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: configModel } = await import('#src/model/outreach/outreach-config-facade.js');

const c = controller as any;
const oid = () => new mongoose.Types.ObjectId().toString();

describe('Outreach Controller (#844 batch model)', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return { json: (obj: any) => { payload = obj; return obj; } };
    },
  };

  // Default actor = the AI agent: create/edit/delete but NOT approve.
  const asAgent = (privileges = ['outreach:create', 'outreach:edit', 'outreach:delete']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };
  const asApprover = () => asAgent(['outreach:approve']);

  const validVenue = (over = {}) => ({
    _id: oid(),
    name: 'The Spot on Kirk',
    email: 'booking@spotonkirk.com',
    contactName: 'Pat',
    venueType: 'Originals',
    status: 'active',
    outreachEligible: true,
    ...over,
  });

  const validTemplate = (over = {}) => ({
    type: 'Originals',
    subject: 'Performance Inquiry for [Venue Name]',
    bodyHtml: '<p>Hi [Contact Name], we are booking our [Booking Period] run and want [Target Dates] at [Venue Name].</p>',
    footerPhotoRef: 'footer-josh-maria',
    ...over,
  });

  beforeEach(() => {
    status = 0;
    payload = undefined;
    sendMail.mockClear();
    sendMail.mockResolvedValue({ messageId: 'mid-123' });
    asAgent();
    (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue()));
    (venueModel as any).find = vi.fn(() => Promise.resolve([]));
    (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
    (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate()));
    (configModel as any).findOne = vi.fn(() => Promise.resolve(null)); // auto-approve OFF by default
    (configModel as any).findOneAndUpdate = vi.fn((_q: any, u: any) => Promise.resolve({ ...u }));
    (configModel as any).create = vi.fn((d: any) => Promise.resolve({ ...d }));
    c.model.findOne = vi.fn(() => Promise.resolve(null));
    c.model.find = vi.fn(() => Promise.resolve([]));
    c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: 'o1', ...doc }));
    c.model.findByIdAndUpdate = vi.fn((id: string, f: any) => Promise.resolve({ _id: id, ...f }));
  });

  describe('authorize', () => {
    it('403s when no send capability is held', async () => {
      asAgent(['outreach:edit']);
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toContain('outreach:create');
    });

    it('401s when the user is not found', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(401);
    });

    it('allows a privilege-less admin via role fallback', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin', privileges: [] }));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
    });
  });

  describe('sendPitch — validation', () => {
    it('rejects a missing/invalid venueId', async () => {
      await c.sendPitch({ user: 'a', body: { targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueId');
    });

    it('rejects missing targetDates', async () => {
      await c.sendPitch({ user: 'a', body: { venueId: oid() } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetDates');
    });

    it('400s when the venue is not found', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venue not found');
    });

    it('400s when the venue is archived', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('archived');
    });

    it('400s when the venue is NOT outreach-eligible (the #844 safety guard)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ outreachEligible: false })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('not outreach-eligible');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('400s when the venue has no email', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no email');
    });

    it('400s when no template type can be resolved', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ venueType: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueType');
    });

    it('400s when no active template exists for the type', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(null));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no active template');
    });
  });

  describe('sendPitch — authorization to send (canSend)', () => {
    const body = () => ({ venueId: oid(), targetDates: 'Aug 14-16', bookingPeriod: 'August' });

    it('403s an agent when auto-approve is OFF (no send)', async () => {
      await c.sendPitch({ user: 'opus', body: body() }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toMatch(/auto-approve is off/);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('an approver sends immediately as a sent record', async () => {
      asApprover();
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect(status).toBe(201);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect((sendMail.mock.calls[0][0] as any).cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.status).toBe('sent');
      expect(rec.step).toBe(1);
      expect(rec.nextTouchDue).toBeInstanceOf(Date);
    });

    it('an agent sends when auto-approve is ON', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.resolve({ autoApprove: true }));
      await c.sendPitch({ user: 'opus', body: body() }, resStub);
      expect(status).toBe(201);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('500s when the auto-approve config read throws', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.reject(new Error('cfg down')));
      await c.sendPitch({ user: 'opus', body: body() }, resStub);
      expect(status).toBe(500);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('dedup-guards an existing active pitch (409, no send)', async () => {
      asApprover();
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'existing', status: 'sent' }));
      await c.sendPitch({ user: 'a', body: body() }, resStub);
      expect(status).toBe(409);
      expect(sendMail).not.toHaveBeenCalled();
      expect((c.model.findOne as any).mock.calls[0][0].status).toEqual({ $in: ['sent', 'replied'] });
    });

    it('honors an explicit templateType', async () => {
      asApprover();
      const findOne = vi.fn(() => Promise.resolve(validTemplate({ type: 'MidRangeCafeBar' })));
      (templateModel as any).findOne = findOne;
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', templateType: 'MidRangeCafeBar' } }, resStub);
      expect(status).toBe(201);
      expect(findOne).toHaveBeenCalledWith({ type: 'MidRangeCafeBar', active: true });
    });
  });

  describe('sendPitch — error handling', () => {
    const send = () => c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);

    it('500s when authorize itself throws', async () => {
      (userModel as any).findById = vi.fn(() => Promise.reject(new Error('auth down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when the venue lookup throws', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.reject(new Error('db down')));
      await send();
      expect(status).toBe(500);
      expect(payload.message).toContain('db down');
    });

    it('500s when the template lookup throws', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.reject(new Error('tpl down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when the dedup lookup throws', async () => {
      asApprover();
      c.model.findOne = vi.fn(() => Promise.reject(new Error('dedup down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when the record write throws', async () => {
      asApprover();
      c.model.create = vi.fn(() => Promise.reject(new Error('insert down')));
      await send();
      expect(status).toBe(500);
    });

    it('502s when the email send fails', async () => {
      asApprover();
      sendMail.mockRejectedValueOnce(new Error('smtp'));
      await send();
      expect(status).toBe(502);
    });
  });

  describe('sendBatch (#844)', () => {
    it('403s without a send capability', async () => {
      asAgent(['outreach:edit']);
      await c.sendBatch({ user: 'a', body: { venueIds: [oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(403);
    });

    it('400s when venueIds is missing or empty', async () => {
      await c.sendBatch({ user: 'a', body: { targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueIds');
      await c.sendBatch({ user: 'a', body: { venueIds: [], targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
    });

    it('400s when targetDates is missing', async () => {
      await c.sendBatch({ user: 'a', body: { venueIds: [oid()] } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetDates');
    });

    it('403s an agent when auto-approve is OFF', async () => {
      await c.sendBatch({ user: 'opus', body: { venueIds: [oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(403);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends to every approved venue and reports the summary', async () => {
      asApprover();
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid(), oid()], targetDates: 'Aug 14-16', bookingPeriod: 'August' } }, resStub);
      expect(status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(payload).toMatchObject({ requested: 2, sent: 2 });
      expect(payload.skipped).toHaveLength(0);
      expect(payload.records).toHaveLength(2);
    });

    it('skips an invalid id but still sends the valid one', async () => {
      asApprover();
      await c.sendBatch({ user: 'josh', body: { venueIds: ['bad', oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(payload.sent).toBe(1);
      expect(payload.skipped).toEqual([{ venueId: 'bad', reason: 'invalid id' }]);
    });

    it('skips an ineligible venue (collected, batch continues)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn()
        .mockResolvedValueOnce(validVenue())
        .mockResolvedValueOnce(validVenue({ outreachEligible: false }));
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid(), oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(payload.sent).toBe(1);
      expect(payload.skipped).toHaveLength(1);
      expect(payload.skipped[0].reason).toContain('not outreach-eligible');
    });

    it('skips a venue whose send fails', async () => {
      asApprover();
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(payload.sent).toBe(0);
      expect(payload.skipped).toHaveLength(1);
      expect(payload.skipped[0].reason).toContain('email send failed');
    });

    it('lets an agent batch-send when auto-approve is ON', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.resolve({ autoApprove: true }));
      await c.sendBatch({ user: 'opus', body: { venueIds: [oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(200);
      expect(payload.sent).toBe(1);
    });
  });

  describe('getCandidates (#844)', () => {
    it('403s without an outreach capability', async () => {
      asAgent(['venue:create']);
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(403);
    });

    it('returns the eligible venues', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }, { _id: 'b' }]));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(2);
      expect((venueModel as any).find).toHaveBeenCalledWith(expect.objectContaining({ outreachEligible: true }));
    });

    it('excludes venues already pitched for the target dates', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }, { _id: 'b' }]));
      c.model.find = vi.fn(() => Promise.resolve([{ venueId: 'a' }]));
      await c.getCandidates({ user: 'a', query: { targetDates: 'Aug 14-16' } }, resStub);
      expect(payload).toHaveLength(1);
      expect(payload[0]._id).toBe('b');
    });

    it('500s when the venue query throws', async () => {
      (venueModel as any).find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(500);
    });

    it('500s when the active-outreach query throws', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getCandidates({ user: 'a', query: { targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(500);
    });
  });

  describe('previewByVenue (#844)', () => {
    it('renders the exact email without sending', async () => {
      await c.previewByVenue({ user: 'a', query: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(200);
      expect(sendMail).not.toHaveBeenCalled();
      expect(payload.subject).toContain('The Spot on Kirk');
      expect(payload.html).toContain('Hi Pat,');
      expect(payload.cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
    });

    it('previews even a non-eligible venue (read-only, requireEligible off)', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ outreachEligible: false })));
      await c.previewByVenue({ user: 'a', query: { venueId: oid() } }, resStub);
      expect(status).toBe(200);
    });

    it('400s on an invalid venueId', async () => {
      await c.previewByVenue({ user: 'a', query: { venueId: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('400s when the venue is not found', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.previewByVenue({ user: 'a', query: { venueId: oid() } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venue not found');
    });
  });

  describe('config — auto-approve (#844)', () => {
    it('reads the default (OFF) when no doc exists', async () => {
      await c.getOutreachConfig({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toEqual({ autoApprove: false });
    });

    it('reads ON when the doc says so', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.resolve({ autoApprove: true }));
      await c.getOutreachConfig({ user: 'a', query: {} }, resStub);
      expect(payload).toEqual({ autoApprove: true });
    });

    it('500s when the config read throws', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getOutreachConfig({ user: 'a', query: {} }, resStub);
      expect(status).toBe(500);
    });

    it('only an approver may set it (agent 403s)', async () => {
      await c.setOutreachConfig({ user: 'opus', body: { autoApprove: true } }, resStub);
      expect(status).toBe(403);
    });

    it('400s when autoApprove is not a boolean', async () => {
      asApprover();
      await c.setOutreachConfig({ user: 'josh', body: {} }, resStub);
      expect(status).toBe(400);
    });

    it('sets the flag (upsert returns the doc)', async () => {
      asApprover();
      await c.setOutreachConfig({ user: 'josh', body: { autoApprove: true } }, resStub);
      expect(status).toBe(200);
      expect(payload).toEqual({ autoApprove: true });
    });

    it('creates the doc when none exists yet', async () => {
      asApprover();
      (configModel as any).findOneAndUpdate = vi.fn(() => Promise.resolve(null));
      (configModel as any).create = vi.fn(() => Promise.resolve({ autoApprove: false }));
      await c.setOutreachConfig({ user: 'josh', body: { autoApprove: false } }, resStub);
      expect(status).toBe(200);
      expect((configModel as any).create).toHaveBeenCalled();
      expect(payload).toEqual({ autoApprove: false });
    });

    it('500s when the write throws', async () => {
      asApprover();
      (configModel as any).findOneAndUpdate = vi.fn(() => Promise.reject(new Error('db down')));
      await c.setOutreachConfig({ user: 'josh', body: { autoApprove: true } }, resStub);
      expect(status).toBe(500);
    });
  });

  describe('updateOutreach', () => {
    it('rejects an invalid id', async () => {
      await c.updateOutreach({ user: 'a', params: { id: 'bad' }, body: {} }, resStub);
      expect(status).toBe(400);
    });

    it('rejects an invalid status', async () => {
      await c.updateOutreach({ user: 'a', params: { id: oid() }, body: { status: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status not valid');
    });

    it('updates status + threadId', async () => {
      const id = oid();
      const upd = vi.fn(() => Promise.resolve({ _id: id, status: 'booked' }));
      c.model.findByIdAndUpdate = upd;
      await c.updateOutreach({ user: 'agent', params: { id }, body: { status: 'booked', gmailThreadId: 't1' } }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'booked', gmailThreadId: 't1', lastModifiedBy: 'agent' }));
    });

    it('nulls nextTouchDue when halting to a terminal status (#850)', async () => {
      const id = oid();
      const upd = vi.fn(() => Promise.resolve({ _id: id, status: 'no-response' }));
      c.model.findByIdAndUpdate = upd;
      await c.updateOutreach({ user: 'josh', params: { id }, body: { status: 'no-response' } }, resStub);
      expect(status).toBe(200);
      expect(upd.mock.calls[0][1].nextTouchDue).toBeNull();
    });

    it('leaves nextTouchDue untouched when no terminal status is set', async () => {
      const id = oid();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateOutreach({ user: 'josh', params: { id }, body: { gmailThreadId: 't9' } }, resStub);
      expect(upd.mock.calls[0][1]).not.toHaveProperty('nextTouchDue');
    });

    it('500s when the update throws', async () => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db down')));
      await c.updateOutreach({ user: 'a', params: { id: oid() }, body: { status: 'booked' } }, resStub);
      expect(status).toBe(500);
    });

    it('400s when the record is not found', async () => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve(null));
      await c.updateOutreach({ user: 'a', params: { id: oid() }, body: { status: 'booked' } }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('getOutreach / listOutreach', () => {
    it('getOutreach rejects an invalid id', async () => {
      await c.getOutreach({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('getOutreach returns a found record', async () => {
      const id = oid();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, status: 'sent' }));
      await c.getOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(payload.status).toBe('sent');
    });

    it('getOutreach 400s when nothing is found', async () => {
      c.model.findById = vi.fn(() => Promise.resolve(null));
      await c.getOutreach({ user: 'a', params: { id: oid() } }, resStub);
      expect(status).toBe(400);
    });

    it('buildListFilter filters by venueId and status', () => {
      const f = (controller as any).constructor.buildListFilter({ venueId: 'v1', status: 'sent' });
      expect(f).toEqual({ venueId: 'v1', status: 'sent' });
    });

    it('listOutreach returns the collection', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ status: 'sent' }]));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(1);
    });

    it('listOutreach 500s when the query throws', async () => {
      c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(500);
    });
  });

  describe('advanceCadence (#824)', () => {
    const dueRecord = (over = {}) => ({
      _id: 'o1', venueId: oid(), sentAt: new Date('2026-06-01T12:00:00Z'), step: 1, targetDates: 'Aug 14-16', followUps: [], ...over,
    });

    beforeEach(() => { c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({})); });

    it('403s without the outreach:edit capability', async () => {
      asAgent(['outreach:create']);
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(status).toBe(403);
    });

    it('sends a due follow-up and reschedules the record', async () => {
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(status).toBe(200);
      expect(payload).toMatchObject({ processed: 1, sent: 1, parked: 0, skipped: 0 });
      expect(sendMail).toHaveBeenCalledTimes(1);
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.step).toBe(2);
      expect(upd.nextTouchDue).toBeInstanceOf(Date);
      expect(upd.followUps).toHaveLength(1);
      expect(upd.followUps[0].step).toBe(2);
    });

    it('parks an exhausted sequence as no-response (no send)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([dueRecord({ step: 3 })]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, parked: 1 });
      expect(sendMail).not.toHaveBeenCalled();
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.status).toBe('no-response');
      expect(upd.nextTouchDue).toBeNull();
    });

    it('skips a record whose venue is archived or has no email', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, sent: 0 });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('skips a record when its follow-up send fails', async () => {
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1 });
    });

    it('500s when the due query throws', async () => {
      c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(status).toBe(500);
    });

    it('reports an empty tick when nothing is due', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 0, sent: 0, parked: 0, skipped: 0 });
    });
  });
});

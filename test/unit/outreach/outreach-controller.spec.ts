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

const c = controller as any;

describe('Outreach Controller', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return { json: (obj: any) => { payload = obj; return obj; } };
    },
  };

  const asAgent = (privileges = ['outreach:create', 'outreach:edit', 'outreach:delete']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  const validVenue = (over = {}) => ({
    _id: new mongoose.Types.ObjectId().toString(),
    name: 'The Spot on Kirk',
    email: 'booking@spotonkirk.com',
    contactName: 'Pat',
    venueType: 'Originals',
    status: 'active',
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
    (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
    (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate()));
    c.model.findOne = vi.fn(() => Promise.resolve(null));
    c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: 'o1', ...doc }));
  });

  describe('authorize', () => {
    it('403s when the outreach:create capability is missing', async () => {
      asAgent(['outreach:edit']);
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
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
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
    });
  });

  describe('sendPitch validation', () => {
    it('rejects a missing/invalid venueId', async () => {
      await c.sendPitch({ user: 'a', body: { targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueId');
    });

    it('rejects missing targetDates', async () => {
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetDates');
    });

    it('400s when the venue is not found', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venue not found');
    });

    it('400s when the venue is archived', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('archived');
    });

    it('400s when the venue has no email', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no email');
    });

    it('400s when no template type can be resolved', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ venueType: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueType');
    });

    it('400s when no active template exists for the type', async () => {
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(null));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no active template');
    });
  });

  describe('sendPitch — draft-first (#844)', () => {
    it('creates a DRAFT and sends NOTHING by default', async () => {
      await c.sendPitch({
        user: 'opus', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', bookingPeriod: 'late-summer', actor: 'opus' },
      }, resStub);
      expect(status).toBe(201);
      expect(sendMail).not.toHaveBeenCalled();
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.status).toBe('draft');
      expect(rec.templateUsed).toBe('Originals');
      expect(rec.messageId).toBeUndefined();
      expect(payload.message).toMatch(/approval/i);
    });

    it('dedup-guards against an existing draft/live pitch (409), incl. drafts', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'existing', status: 'draft' }));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(409);
      expect(sendMail).not.toHaveBeenCalled();
      expect((c.model.findOne as any).mock.calls[0][0].status).toEqual({ $in: ['draft', 'sent', 'replied'] });
    });

    it('honors an explicit templateType (still a draft)', async () => {
      const findOne = vi.fn(() => Promise.resolve(validTemplate({ type: 'MidRangeCafeBar' })));
      (templateModel as any).findOne = findOne;
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', templateType: 'MidRangeCafeBar' } }, resStub);
      expect(status).toBe(201);
      expect(findOne).toHaveBeenCalledWith({ type: 'MidRangeCafeBar', active: true });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('refuses override without outreach:approve (403, no send)', async () => {
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', override: true } }, resStub);
      expect(status).toBe(403);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('override + outreach:approve sends immediately as a sent record', async () => {
      asAgent(['outreach:create', 'outreach:approve']);
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', override: true } }, resStub);
      expect(status).toBe(201);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.status).toBe('sent');
      expect(rec.step).toBe(1);
    });
  });

  describe('approveOutreach (#844) — the only normal send path', () => {
    const draft = (over = {}) => ({
      _id: 'd1', venueId: validVenue()._id, templateUsed: 'Originals', targetDates: 'Aug 14-16', bookingPeriod: 'late-summer', status: 'draft', ...over,
    });
    beforeEach(() => { c.model.findByIdAndUpdate = vi.fn((id: string, f: any) => Promise.resolve({ _id: id, ...f })); });

    it('403s without outreach:approve — the agent cannot approve', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.approveOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(403);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('renders + sends + flips draft to sent + schedules cadence', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(draft()));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect((sendMail.mock.calls[0][0] as any).cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.status).toBe('sent');
      expect(upd.messageId).toBe('mid-123');
      expect(upd.step).toBe(1);
      expect(upd.nextTouchDue).toBeInstanceOf(Date);
    });

    it('400s when the record is not a draft', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(draft({ status: 'sent' })));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(400);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('400s when the draft is not found', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(null));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(400);
    });

    it('502s when the approved send fails', async () => {
      asAgent(['outreach:approve']);
      sendMail.mockRejectedValueOnce(new Error('smtp'));
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(draft()));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(502);
    });

    it('400s on an invalid id', async () => {
      asAgent(['outreach:approve']);
      await c.approveOutreach({ user: 'josh', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('500s when the lookup throws', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.reject(new Error('db down')));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(500);
    });

    it('relays a resolve error if the venue went archived since drafting', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(draft()));
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      await c.approveOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(400);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('override create-record path still stamps cadence (finalizeSend create branch)', async () => {
      asAgent(['outreach:create', 'outreach:approve']);
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', override: true } }, resStub);
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.nextTouchDue).toBeInstanceOf(Date);
    });
  });

  describe('rejectOutreach + previewOutreach (#844)', () => {
    it('reject 403s without outreach:approve', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.rejectOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(403);
    });

    it('reject marks a draft rejected', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id, status: 'rejected' }));
      c.model.findByIdAndUpdate = upd;
      await c.rejectOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'rejected' }));
    });

    it('preview renders the exact email without sending', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({
        _id: id, venueId: validVenue()._id, templateUsed: 'Originals', targetDates: 'Aug 14-16', bookingPeriod: 'late-summer', status: 'draft',
      }));
      await c.previewOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(sendMail).not.toHaveBeenCalled();
      expect(payload.subject).toContain('The Spot on Kirk');
      expect(payload.html).toContain('Hi Pat,');
      expect(payload.cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
    });

    it('reject 400s on an invalid id', async () => {
      asAgent(['outreach:approve']);
      await c.rejectOutreach({ user: 'josh', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('reject 400s when not found', async () => {
      asAgent(['outreach:approve']);
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve(null));
      await c.rejectOutreach({ user: 'josh', params: { id } }, resStub);
      expect(status).toBe(400);
    });

    it('preview 400s on an invalid id', async () => {
      await c.previewOutreach({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('preview 400s when the draft is not found', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(null));
      await c.previewOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('sendPitch error handling', () => {
    const send = () => c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);

    it('500s when the venue lookup throws', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.reject(new Error('db down')));
      await send();
      expect(status).toBe(500);
      expect(payload.message).toContain('db down');
    });

    it('500s when the template lookup throws', async () => {
      (templateModel as any).findOne = vi.fn(() => Promise.reject(new Error('tpl down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when the dedup lookup throws', async () => {
      c.model.findOne = vi.fn(() => Promise.reject(new Error('dedup down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when the record write throws', async () => {
      c.model.create = vi.fn(() => Promise.reject(new Error('insert down')));
      await send();
      expect(status).toBe(500);
    });

    it('500s when authorize itself throws', async () => {
      (userModel as any).findById = vi.fn(() => Promise.reject(new Error('auth down')));
      await send();
      expect(status).toBe(500);
    });
  });

  describe('updateOutreach', () => {
    it('rejects an invalid id', async () => {
      await c.updateOutreach({ user: 'a', params: { id: 'bad' }, body: {} }, resStub);
      expect(status).toBe(400);
    });

    it('rejects an invalid status', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.updateOutreach({ user: 'a', params: { id }, body: { status: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status not valid');
    });

    it('updates status + threadId', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id, status: 'booked' }));
      c.model.findByIdAndUpdate = upd;
      await c.updateOutreach({ user: 'agent', params: { id }, body: { status: 'booked', gmailThreadId: 't1' } }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'booked', gmailThreadId: 't1', lastModifiedBy: 'agent' }));
    });
  });

  describe('getOutreach', () => {
    it('rejects an invalid id', async () => {
      await c.getOutreach({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('returns a found record', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, status: 'sent' }));
      await c.getOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(payload.status).toBe('sent');
    });
  });

  describe('listOutreach / buildListFilter', () => {
    it('filters by venueId and status', () => {
      const f = (controller as any).constructor.buildListFilter({ venueId: 'v1', status: 'sent' });
      expect(f).toEqual({ venueId: 'v1', status: 'sent' });
    });

    it('returns the collection', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ status: 'sent' }]));
      await c.listOutreach({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(1);
    });
  });

  // (Cadence touch 1 / nextTouchDue is stamped at APPROVAL now, not at draft —
  // asserted in the approveOutreach block above.)

  describe('advanceCadence (#824)', () => {
    const dueRecord = (over = {}) => ({
      _id: 'o1', venueId: validVenue()._id, sentAt: new Date('2026-06-01T12:00:00Z'), step: 1, targetDates: 'Aug 14-16', followUps: [], ...over,
    });

    beforeEach(() => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
    });

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

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

  describe('sendPitch dedup guard', () => {
    it('409s when an active outreach already exists for the venue + window', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'existing', status: 'sent' }));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(409);
      expect(sendMail).not.toHaveBeenCalled();
      const filter = (c.model.findOne as any).mock.calls[0][0];
      expect(filter.status).toEqual({ $in: ['sent', 'replied'] });
    });
  });

  describe('sendPitch success', () => {
    it('personalizes, CCs Josh + Maria, attaches the footer, and writes the record', async () => {
      const venueId = validVenue()._id;
      await c.sendPitch({
        user: 'opus', body: { venueId, targetDates: 'Fri Aug 14 – Sun Aug 16', bookingPeriod: 'late-summer', actor: 'opus' },
      }, resStub);

      expect(status).toBe(201);
      const mail = sendMail.mock.calls[0][0] as any;
      expect(mail.to).toBe('booking@spotonkirk.com');
      expect(mail.cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
      expect(mail.subject).toBe('Performance Inquiry for The Spot on Kirk');
      expect(mail.html).toContain('Hi Pat,');
      expect(mail.html).toContain('late-summer');
      expect(mail.html).toContain('Fri Aug 14 – Sun Aug 16');
      expect(mail.html).not.toContain('[');
      expect(mail.html).toContain('cid:footerphoto');
      expect(mail.attachments[0].cid).toBe('footerphoto');

      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.venueId).toBe(venueId);
      expect(rec.templateUsed).toBe('Originals');
      expect(rec.status).toBe('sent');
      expect(rec.messageId).toBe('mid-123');
      expect(rec.sentBy).toBe('opus');
      expect((venueModel as any).findByIdAndUpdate).toHaveBeenCalled();
    });

    it('honors an explicit templateType over the venue type', async () => {
      const findOne = vi.fn(() => Promise.resolve(validTemplate({ type: 'MidRangeCafeBar' })));
      (templateModel as any).findOne = findOne;
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16', templateType: 'MidRangeCafeBar' } }, resStub);
      expect(status).toBe(201);
      expect(findOne).toHaveBeenCalledWith({ type: 'MidRangeCafeBar', active: true });
    });

    it('502s and writes no record when the send fails', async () => {
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(502);
      expect(c.model.create).not.toHaveBeenCalled();
    });

    it('succeeds even when the lastContacted stamp fails (best-effort)', async () => {
      (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('write conflict')));
      await c.sendPitch({ user: 'a', body: { venueId: validVenue()._id, targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(201);
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
});

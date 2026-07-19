/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import { EMAIL_RE } from '#src/lib/email.js';

const sendMail = vi.fn(() => Promise.resolve({ messageId: 'mid-123' }));
vi.mock('#src/lib/mailer.js', () => ({
  sendMail,
  default: { sendMail },
}));

const createCallTaskEvent = vi.fn(() => Promise.resolve({ id: 'evt-1' }));
vi.mock('#src/lib/calendar.js', () => ({
  createCallTaskEvent,
  default: { createCallTaskEvent },
}));

const findReplies = vi.fn(() => Promise.resolve([] as any[]));
vi.mock('#src/lib/imap-replies.js', () => ({
  findReplies,
  default: { findReplies },
}));

const classifyReply = vi.fn(() => Promise.resolve(null as any));
vi.mock('#src/lib/classify-reply.js', () => ({
  classifyReply,
  default: { classifyReply },
}));

const { default: controller } = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: configModel } = await import('#src/model/outreach/outreach-config-facade.js');
const { default: gigModel } = await import('#src/model/gig/gig-facade.js');

const c = controller as any;
const oid = () => new mongoose.Types.ObjectId().toString();
// #923 — sendPitch/sendBatch now require a structured targetWeekend on every
// new send. Reused wherever a test body needs to get PAST validation (targetDates
// stays purely cosmetic/display, unrelated to this).
const VALID_WEEKEND = { start: '2026-09-25', end: '2026-09-27' };

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

  // #903 — a migrated template: introHtml split out (greeting), bodyHtml
  // carries the [Custom Body] marker right where the ask begins.
  const templateWithSlots = (over = {}) => ({
    type: 'Originals',
    subject: 'Performance Inquiry for [Venue Name]',
    introHtml: '<p>Hi [Contact Name],</p>',
    bodyHtml: '[Custom Body]<p>we are booking our [Booking Period] run and want [Target Dates] at [Venue Name].</p>',
    footerPhotoRef: 'footer-josh-maria',
    ...over,
  });

  beforeEach(() => {
    status = 0;
    payload = undefined;
    sendMail.mockClear();
    sendMail.mockResolvedValue({ messageId: 'mid-123' });
    createCallTaskEvent.mockClear();
    createCallTaskEvent.mockResolvedValue({ id: 'evt-1' });
    findReplies.mockClear();
    findReplies.mockResolvedValue([]);
    classifyReply.mockClear();
    classifyReply.mockResolvedValue(null);
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
    // #958 — getCandidates now always calls gigModel.find once (safety
    // exclusion + weekend surfacing); default to empty so unrelated tests
    // never hit the real DB. Tests exercising the linkage override this.
    (gigModel as any).find = vi.fn(() => Promise.resolve([]));
  });

  describe('authorize', () => {
    it('403s when no send capability is held', async () => {
      asAgent(['outreach:edit']);
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
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
      await c.sendPitch({ user: 'a', body: { targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
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
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venue not found');
    });

    it('400s when the venue is archived', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('archived');
    });

    it('400s when the venue is NOT outreach-eligible (the #844 safety guard)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ outreachEligible: false })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('not outreach-eligible');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('400s when the venue has no email', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no valid primary email');
      expect(sendMail).not.toHaveBeenCalled();
    });

    // #974 — sendability precondition is FORMAT-checked, not just presence: a
    // venue with a garbage-looking primary email is just as unsendable as one
    // with none at all. Additional to (not a replacement for) outreachEligible.
    it('400s when the venue email is present but not a valid format (#974)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: 'not-an-email' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no valid primary email');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('400s when no template type can be resolved', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ venueType: '' })));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueType');
    });

    it('400s when no active template exists for the type', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(null));
      await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('no active template');
    });

    // #923 — targetWeekend is required on every NEW send (dedup + eventual
    // target-filled logic key on it; targetDates stays display-only).
    describe('targetWeekend required (#923)', () => {
      it('rejects a missing targetWeekend', async () => {
        asApprover();
        await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('targetWeekend');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('rejects a targetWeekend missing its end bound', async () => {
        asApprover();
        await c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: { start: '2026-09-25' } } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('targetWeekend');
      });

      it('rejects an unparseable targetWeekend date', async () => {
        asApprover();
        await c.sendPitch(
          { user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: { start: 'not-a-date', end: '2026-09-27' } } },
          resStub,
        );
        expect(status).toBe(400);
        expect(payload.message).toContain('targetWeekend');
      });

      it('rejects an inverted targetWeekend range (start after end)', async () => {
        asApprover();
        await c.sendPitch(
          { user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: { start: '2026-09-27', end: '2026-09-25' } } },
          resStub,
        );
        expect(status).toBe(400);
        expect(payload.message).toContain('targetWeekend');
      });
    });
  });

  describe('sendPitch — authorization to send (canSend)', () => {
    const body = () => ({ venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND, bookingPeriod: 'August' });

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
      expect((sendMail as any).mock.calls[0][0].cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.status).toBe('sent');
      expect(rec.step).toBe(1);
      expect(rec.nextTouchDue).toBeInstanceOf(Date);
    });

    // #974 (reshaped 2026-07-18 per Josh — secondary rides in Cc, not To): a
    // venue with a secondaryEmail on file still gets ONE send, `to` is the
    // primary ONLY, and the secondary is appended to the Cc list.
    it('CCs secondaryEmail (never To) when the venue has one (#974)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ secondaryEmail: 'chelsea@slowplaybrewing.com' })));
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect(status).toBe(201);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect((sendMail as any).mock.calls[0][0].to).toBe('booking@spotonkirk.com');
      expect((sendMail as any).mock.calls[0][0].cc).toEqual([
        'joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com', 'chelsea@slowplaybrewing.com',
      ]);
    });

    // #974 — a malformed secondaryEmail (shouldn't happen given write-path
    // validation, but defense-in-depth) never blocks the send to the valid
    // primary — it's just dropped from Cc, leaving the base Cc unchanged.
    it('falls back to the base Cc (unchanged) when secondaryEmail is present but not a valid format (#974)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ secondaryEmail: 'not-an-email' })));
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect(status).toBe(201);
      expect((sendMail as any).mock.calls[0][0].to).toBe('booking@spotonkirk.com');
      expect((sendMail as any).mock.calls[0][0].cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
    });

    it('sends to just the primary with the plain PITCH_CC when there is no secondaryEmail', async () => {
      asApprover();
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect((sendMail as any).mock.calls[0][0].to).toBe('booking@spotonkirk.com');
      expect((sendMail as any).mock.calls[0][0].cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
    });

    // #974 — performSend honors a caller-supplied body.cc override; the
    // secondary is appended to THAT base, not to PITCH_CC underneath it.
    it('appends secondaryEmail to a caller-supplied body.cc override, not PITCH_CC (#974)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ secondaryEmail: 'chelsea@slowplaybrewing.com' })));
      await c.sendPitch({ user: 'josh', body: { ...body(), cc: ['someone-else@example.com'] } }, resStub);
      expect(status).toBe(201);
      expect((sendMail as any).mock.calls[0][0].to).toBe('booking@spotonkirk.com');
      expect((sendMail as any).mock.calls[0][0].cc).toEqual(['someone-else@example.com', 'chelsea@slowplaybrewing.com']);
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

    // #923 — the guard is now keyed on an OVERLAPPING targetWeekend range, not
    // targetDates string equality (root cause of the 7/5 duplicate-cadence
    // incident: 'Sept 25 to 27' / 'Sep 25-27' / 'Friday, September 25...' never
    // string-matched despite being the same weekend).
    describe('dedup guard rekeyed on targetWeekend overlap (#923)', () => {
      it('queries an overlap range keyed on the sent targetWeekend, not targetDates', async () => {
        asApprover();
        c.model.findOne = vi.fn(() => Promise.resolve(null));
        await c.sendPitch({ user: 'a', body: body() }, resStub);
        const query = (c.model.findOne as any).mock.calls[0][0];
        expect(query.targetDates).toBeUndefined();
        expect(query['targetWeekend.start']).toEqual({ $exists: true, $lte: new Date(VALID_WEEKEND.end) });
        expect(query['targetWeekend.end']).toEqual({ $exists: true, $gte: new Date(VALID_WEEKEND.start) });
      });

      it('409s when an existing record has an overlapping (not identical) targetWeekend', async () => {
        asApprover();
        // Existing record's range (Sept 24-26) overlaps the new send's (Sept 25-27)
        // without being identical — this is exactly the case string-matching missed.
        c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'existing', status: 'sent' }));
        await c.sendPitch({ user: 'a', body: body() }, resStub);
        expect(status).toBe(409);
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('sends when no overlapping active record exists (dedup query itself excludes legacy no-targetWeekend records)', async () => {
        asApprover();
        c.model.findOne = vi.fn(() => Promise.resolve(null));
        await c.sendPitch({ user: 'a', body: body() }, resStub);
        expect(status).toBe(201);
        expect(sendMail).toHaveBeenCalledTimes(1);
      });

      it('stores the real targetWeekend Dates on the created record', async () => {
        asApprover();
        await c.sendPitch({ user: 'a', body: body() }, resStub);
        const rec = (c.model.create as any).mock.calls[0][0];
        expect(rec.targetWeekend).toEqual({ start: new Date(VALID_WEEKEND.start), end: new Date(VALID_WEEKEND.end) });
      });
    });

    it('honors an explicit templateType', async () => {
      asApprover();
      const findOne = vi.fn(() => Promise.resolve(validTemplate({ type: 'MidRangeCafeBar' })));
      (templateModel as any).findOne = findOne;
      await c.sendPitch(
        { user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND, templateType: 'MidRangeCafeBar' } },
        resStub,
      );
      expect(status).toBe(201);
      expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ type: 'MidRangeCafeBar', active: true }));
    });
  });

  describe('sendPitch — error handling', () => {
    const send = () => c.sendPitch({ user: 'a', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);

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

  describe('template by stage (#848)', () => {
    it('resolveStage: an explicit relationshipStage wins over auto-derive', async () => {
      expect(await c.resolveStage(validVenue({ relationshipStage: 'returning' }))).toBe('returning');
      expect(await c.resolveStage(validVenue({ relationshipStage: 'cold', bookingStatus: 'booked' }))).toBe('cold');
    });

    it('resolveStage: a booked venue auto-derives returning', async () => {
      expect(await c.resolveStage(validVenue({ bookingStatus: 'booked' }))).toBe('returning');
    });

    it('resolveStage: a prior replied/booked outreach makes it returning', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'o', status: 'replied' }));
      expect(await c.resolveStage(validVenue())).toBe('returning');
    });

    it('resolveStage: otherwise cold', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      expect(await c.resolveStage(validVenue())).toBe('cold');
    });

    it('findTemplate: uses the returning variant when present', async () => {
      const findOne = vi.fn(() => Promise.resolve(validTemplate({ stage: 'returning' })));
      (templateModel as any).findOne = findOne;
      const t = await c.findTemplate('Originals', 'returning');
      expect((t as any).stage).toBe('returning');
      expect(findOne).toHaveBeenCalledWith({ type: 'Originals', active: true, stage: 'returning' });
    });

    it('findTemplate: returning falls back to cold when no returning variant exists', async () => {
      const findOne = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(validTemplate());
      (templateModel as any).findOne = findOne;
      const t = await c.findTemplate('Originals', 'returning');
      expect(t).toBeTruthy();
      expect(findOne).toHaveBeenCalledTimes(2);
    });

    it('send uses the per-venue templateOverride as the type', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ venueType: 'Originals', templateOverride: 'MidRangeCafeBar' })));
      await c.sendPitch({ user: 'josh', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(201);
      expect((c.model.create as any).mock.calls[0][0].templateUsed).toBe('MidRangeCafeBar');
    });
  });

  describe('sendBatch (#844)', () => {
    it('403s without a send capability', async () => {
      asAgent(['outreach:edit']);
      await c.sendBatch({ user: 'a', body: { venueIds: [oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(403);
    });

    it('400s when venueIds is missing or empty', async () => {
      await c.sendBatch({ user: 'a', body: { targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueIds');
      await c.sendBatch({ user: 'a', body: { venueIds: [], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(400);
    });

    it('400s when targetDates is missing', async () => {
      await c.sendBatch({ user: 'a', body: { venueIds: [oid()] } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetDates');
    });

    it('400s when targetWeekend is missing (#923)', async () => {
      await c.sendBatch({ user: 'a', body: { venueIds: [oid()], targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetWeekend');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('403s an agent when auto-approve is OFF', async () => {
      await c.sendBatch({ user: 'opus', body: { venueIds: [oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(403);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends to every approved venue and reports the summary', async () => {
      asApprover();
      await c.sendBatch(
        { user: 'josh', body: { venueIds: [oid(), oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND, bookingPeriod: 'August' } },
        resStub,
      );
      expect(status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(payload).toMatchObject({ requested: 2, sent: 2 });
      expect(payload.skipped).toHaveLength(0);
      expect(payload.records).toHaveLength(2);
    });

    it('skips an invalid id but still sends the valid one', async () => {
      asApprover();
      await c.sendBatch({ user: 'josh', body: { venueIds: ['bad', oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(payload.sent).toBe(1);
      expect(payload.skipped).toEqual([{ venueId: 'bad', reason: 'invalid id' }]);
    });

    it('skips an ineligible venue (collected, batch continues)', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn()
        .mockResolvedValueOnce(validVenue())
        .mockResolvedValueOnce(validVenue({ outreachEligible: false }));
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid(), oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(payload.sent).toBe(1);
      expect(payload.skipped).toHaveLength(1);
      expect(payload.skipped[0].reason).toContain('not outreach-eligible');
    });

    it('skips a venue whose send fails', async () => {
      asApprover();
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(payload.sent).toBe(0);
      expect(payload.skipped).toHaveLength(1);
      expect(payload.skipped[0].reason).toContain('email send failed');
    });

    it('lets an agent batch-send when auto-approve is ON', async () => {
      (configModel as any).findOne = vi.fn(() => Promise.resolve({ autoApprove: true }));
      await c.sendBatch({ user: 'opus', body: { venueIds: [oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
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

    // #980 — doNotContact is gone entirely (folded into outreachEligible,
    // the SOLE permanent stop/go gate now) — the query must never reference
    // it anymore.
    it('no longer references doNotContact in the query (#980)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      const callArg = (venueModel as any).find.mock.calls[0][0];
      expect(callArg).not.toHaveProperty('doNotContact');
    });

    // #980 — no active resumeBooking cooldown: unset, null, or already in
    // the past are all fine; only a future date blocks. Enforced at the
    // query level (ADDITIONAL to outreachEligible, never a replacement).
    it('excludes an active resumeBooking cooldown via the query (#980)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      const callArg = (venueModel as any).find.mock.calls[0][0];
      expect(callArg.$or).toEqual(expect.arrayContaining([
        { resumeBooking: { $exists: false } },
        { resumeBooking: null },
        { resumeBooking: { $lte: expect.any(Date) } },
      ]));
    });

    // #980 — optional cities filter, AND'd with every other criterion;
    // omitted/empty = all cities (back-compat).
    describe('cities filter (#980)', () => {
      it('adds a city $in clause when cities is given', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        await c.getCandidates({ user: 'a', query: { cities: 'Salem,Roanoke' } }, resStub);
        expect(status).toBe(200);
        const callArg = (venueModel as any).find.mock.calls[0][0];
        expect(callArg.city).toEqual({ $in: ['Salem', 'Roanoke'] });
      });

      it('trims whitespace and drops empty entries from a comma-separated cities list', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        await c.getCandidates({ user: 'a', query: { cities: ' Salem , , Roanoke ' } }, resStub);
        const callArg = (venueModel as any).find.mock.calls[0][0];
        expect(callArg.city).toEqual({ $in: ['Salem', 'Roanoke'] });
      });

      it('omits the city clause entirely when cities is absent — all cities (back-compat)', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        const callArg = (venueModel as any).find.mock.calls[0][0];
        expect(callArg).not.toHaveProperty('city');
      });

      it('omits the city clause when cities is an empty string', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        await c.getCandidates({ user: 'a', query: { cities: '' } }, resStub);
        const callArg = (venueModel as any).find.mock.calls[0][0];
        expect(callArg).not.toHaveProperty('city');
      });
    });

    // #974 — the sendability precondition (no VALID primary email = not
    // sendable) is enforced at the query level too, ADDITIONAL to (not a
    // replacement for) the outreachEligible clause asserted above: not just
    // "has an email" ($nin) but "looks like a real one" ($regex EMAIL_RE).
    it('requires a format-valid primary email in the query, not just non-empty (#974)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      const callArg = (venueModel as any).find.mock.calls[0][0];
      expect(callArg.email).toEqual({ $nin: [null, ''], $regex: EMAIL_RE });
      // still gated on outreachEligible too — this is additive, not a swap.
      expect(callArg.outreachEligible).toBe(true);
    });

    // #958 — a targetWeekend request wraps the response in { candidates,
    // weekendGigs } (weekendGigs added below); no targetWeekend keeps the
    // plain array (see 'does not filter...' below).
    it('excludes venues already pitched for an overlapping target weekend (#898)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }, { _id: 'b' }]));
      const findMock = vi.fn(() => Promise.resolve([{ venueId: 'a' }]));
      c.model.find = findMock;
      await c.getCandidates({ user: 'a', query: { targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(payload.candidates).toHaveLength(1);
      expect(payload.candidates[0]._id).toBe('b');
      expect(payload.weekendGigs).toEqual([]);
      expect(findMock).toHaveBeenCalledWith(expect.objectContaining({
        status: { $in: ['sent', 'replied'] },
        'targetWeekend.start': { $exists: true, $lte: new Date(VALID_WEEKEND.end) },
        'targetWeekend.end': { $exists: true, $gte: new Date(VALID_WEEKEND.start) },
      }));
    });

    // #980 — the gigInterval-aware generalization of the old #958 SAFETY
    // blanket exclusion. gigInterval=0 (every venue's default, and every
    // venue's value before the #980 migration) now means NO spacing check at
    // all — the old "any upcoming linked gig excludes forever" rule (the
    // "repeat-venue trap" #980 fixes) is gone by design. A venue only gets
    // spaced out once it's explicitly opted in via gigInterval > 0.
    describe('gigInterval spacing (#980)', () => {
      it('does NOT drop a venue with an upcoming gig when gigInterval is 0 (the default) — the repeat-venue trap is fixed', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 0 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: new Date(Date.now() + 86400000).toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload).toHaveLength(1);
      });

      it('does NOT drop a venue with an upcoming gig when gigInterval is unset (default) either', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: new Date(Date.now() + 86400000).toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload).toHaveLength(1);
      });

      it('drops a venue (matched by venueId) whose linked gig is within gigInterval months of the target window', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 3 }, { _id: 'b', gigInterval: 3 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: VALID_WEEKEND.start }, // exactly the target window
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.candidates.map((v: any) => v._id)).toEqual(['b']);
      });

      it('drops a venue matched by exact normalized name whose gig is too close', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', name: 'Durty Bull', gigInterval: 6 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venue: 'DURTY, BULL!', datetime: new Date(Date.now() + 86400000).toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload).toHaveLength(0);
      });

      it('does NOT drop when the linked gig is exactly gigInterval months away (boundary is inclusive of "ok")', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 2 }]));
        const w = new Date(VALID_WEEKEND.start);
        const exactlyTwoMonthsOut = new Date(w); exactlyTwoMonthsOut.setMonth(exactlyTwoMonthsOut.getMonth() + 2);
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: exactlyTwoMonthsOut.toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.candidates).toHaveLength(1);
      });

      it('checks the NEAREST gig on EITHER side of the target window (a past gig can be too close too)', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 3 }]));
        const w = new Date(VALID_WEEKEND.start);
        const oneMonthBefore = new Date(w); oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: oneMonthBefore.toISOString() }, // in the past, but only 1 month from W
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.candidates).toHaveLength(0);
      });

      it('with multiple linked gigs, drops the venue if ANY one of them is too close', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 2 }]));
        const w = new Date(VALID_WEEKEND.start);
        const farBefore = new Date(w); farBefore.setFullYear(farBefore.getFullYear() - 1);
        const farAfter = new Date(w); farAfter.setFullYear(farAfter.getFullYear() + 1);
        const closeAfter = new Date(w); closeAfter.setDate(closeAfter.getDate() + 10);
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: farBefore.toISOString() },
          { venueId: 'a', datetime: closeAfter.toISOString() },
          { venueId: 'a', datetime: farAfter.toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.candidates).toHaveLength(0);
      });

      it('with multiple linked gigs, keeps the venue when EVERY one of them clears the spacing', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 2 }]));
        const w = new Date(VALID_WEEKEND.start);
        const farBefore = new Date(w); farBefore.setFullYear(farBefore.getFullYear() - 1);
        const farAfter = new Date(w); farAfter.setFullYear(farAfter.getFullYear() + 1);
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: farBefore.toISOString() },
          { venueId: 'a', datetime: farAfter.toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.candidates).toHaveLength(1);
      });

      it('uses "now" as the target window when no targetWeekend is given', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 3 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: new Date(Date.now() + 86400000).toISOString() }, // ~tomorrow, well within 3 months of now
        ]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload).toHaveLength(0);
      });

      it('500s when the gig query throws', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        (gigModel as any).find = vi.fn(() => Promise.reject(new Error('db down')));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(500);
      });
    });

    // #980/JaMmusic#1238 — every candidate carries a `reason` object so the
    // Find-Eligible UI can show why it qualified without re-deriving
    // eligibility client-side (buildCandidateReason).
    describe('candidate reason (#980)', () => {
      it('reports spacing off when gigInterval is 0 (the default)', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 0 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(payload[0].reason).toMatchObject({
          gigIntervalMonths: 0, spacingNote: 'spacing off (gigInterval=0)', nearestGigMonthsAway: null, lastGigDate: null,
        });
      });

      it('reports "no gigs yet" when gigInterval is set but the venue has no linked gigs', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 3 }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(payload[0].reason).toMatchObject({ gigIntervalMonths: 3, spacingNote: 'no gigs yet', nearestGigMonthsAway: null });
      });

      it('reports the nearest-gig distance (months) when the venue clears spacing', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 2 }]));
        const w = new Date(VALID_WEEKEND.start);
        const sixMonthsOut = new Date(w); sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: sixMonthsOut.toISOString() },
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(payload.candidates[0].reason.gigIntervalMonths).toBe(2);
        expect(payload.candidates[0].reason.nearestGigMonthsAway).toBeCloseTo(6, 0);
        expect(payload.candidates[0].reason.spacingNote).toContain('clear — nearest gig');
      });

      it('reports lastGigDate as the most recent PAST linked gig, picking the latest among several', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a', gigInterval: 0 }]));
        const older = new Date(Date.now() - 200 * 86400000).toISOString();
        const mostRecent = new Date(Date.now() - 10 * 86400000).toISOString();
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: 'a', datetime: older },
          { venueId: 'a', datetime: mostRecent },
        ]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(payload[0].reason.lastGigDate).toBe(new Date(mostRecent).toISOString());
      });

      it('reports resumeBookingExpired true for a past resumeBooking date', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([
          { _id: 'a', resumeBooking: new Date(Date.now() - 86400000).toISOString() },
        ]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(payload[0].reason.resumeBookingExpired).toBe(true);
      });

      it('reports resumeBookingExpired false when resumeBooking is unset', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(payload[0].reason.resumeBookingExpired).toBe(false);
      });
    });

    // #958 — weekend awareness: surfaces Josh's whole gig schedule for the
    // requested weekend (any venue), independent of the per-venue safety
    // exclusion above.
    describe('weekendGigs surfacing (#958)', () => {
      it('includes gigs inside the requested target weekend', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venue: 'Some Other Venue', datetime: '2026-09-26T00:00:00.000Z' },
          { venue: 'Out Of Range', datetime: '2026-10-10T00:00:00.000Z' },
        ]));
        await c.getCandidates({ user: 'a', query: { targetWeekend: VALID_WEEKEND } }, resStub);
        expect(status).toBe(200);
        expect(payload.weekendGigs).toHaveLength(1);
        expect(payload.weekendGigs[0].venue).toBe('Some Other Venue');
      });

      it('omits weekendGigs entirely when no targetWeekend is requested', async () => {
        (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
        await c.getCandidates({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(Array.isArray(payload)).toBe(true);
      });
    });

    // #898 — targetDates is display-only per #923; a bare targetDates with no
    // targetWeekend must NOT filter anything (the old string-equality filter
    // is gone).
    it('does not filter when only the legacy targetDates is given (#898)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }, { _id: 'b' }]));
      const findMock = vi.fn(() => Promise.resolve([{ venueId: 'a' }]));
      c.model.find = findMock;
      await c.getCandidates({ user: 'a', query: { targetDates: 'Aug 14-16' } }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(2);
      expect(findMock).not.toHaveBeenCalled();
    });

    it('400s an invalid/incomplete targetWeekend (#898)', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      await c.getCandidates({ user: 'a', query: { targetWeekend: { start: '2026-09-25' } } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetWeekend');
    });

    it('500s when the venue query throws', async () => {
      (venueModel as any).find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getCandidates({ user: 'a', query: {} }, resStub);
      expect(status).toBe(500);
    });

    it('500s when the active-outreach query throws', async () => {
      (venueModel as any).find = vi.fn(() => Promise.resolve([{ _id: 'a' }]));
      c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getCandidates({ user: 'a', query: { targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(500);
    });
  });

  describe('previewByVenue (#844)', () => {
    it('renders the exact email without sending', async () => {
      await c.previewByVenue({ user: 'a', query: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
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

  describe('previewByVenue — batch form (venueIds plural) (#1149)', () => {
    it('returns an array for multiple valid venueIds', async () => {
      const id1 = oid();
      const id2 = oid();
      await c.previewByVenue({ user: 'a', query: { venueIds: `${id1},${id2}`, targetDates: 'Sept 25-27' } }, resStub);
      expect(status).toBe(200);
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(2);
      expect(payload[0]).toMatchObject({ venueId: id1, venueName: 'The Spot on Kirk', subject: expect.any(String), body: expect.any(String) });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('skips invalid ids in the batch and still returns valid ones', async () => {
      const id1 = oid();
      await c.previewByVenue({ user: 'a', query: { venueIds: `${id1},not-a-valid-id`, targetDates: 'Sept 25-27' } }, resStub);
      expect(status).toBe(200);
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(1);
      expect(payload[0].venueId).toBe(id1);
    });

    it('skips venues that fail resolution (not found)', async () => {
      const id1 = oid();
      const id2 = oid();
      (venueModel as any).findById = vi.fn()
        .mockResolvedValueOnce(validVenue())
        .mockResolvedValueOnce(null); // second venue not found
      await c.previewByVenue({ user: 'a', query: { venueIds: `${id1},${id2}`, targetDates: 'Sept 25-27' } }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(1);
    });

    it('returns an empty array when all ids are invalid', async () => {
      await c.previewByVenue({ user: 'a', query: { venueIds: 'bad1,bad2,bad3', targetDates: 'Sept 25-27' } }, resStub);
      expect(status).toBe(200);
      expect(payload).toEqual([]);
    });
  });

  // #917 — Josh's CC copy of every outreach send is otherwise indistinguishable
  // from every other one; the subject must always name the target venue,
  // whether or not the template author wired the [Venue Name] token into it.
  describe('subject includes the target venue (#917)', () => {
    it('sendPitch: appends " — <Venue Name>" when the template subject carries no token', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate({ subject: 'Performance Inquiry: Josh and Maria' })));
      await c.sendPitch(
        { user: 'josh', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } },
        resStub,
      );
      expect(status).toBe(201);
      const sentSubject = (sendMail as any).mock.calls[0][0].subject;
      expect(sentSubject).toBe('Performance Inquiry: Josh and Maria — The Spot on Kirk');
    });

    it('sendPitch: does not duplicate the venue name when the template subject already tokenizes it', async () => {
      asApprover();
      // validTemplate()'s subject is 'Performance Inquiry for [Venue Name]' — personalize() already fills it.
      await c.sendPitch(
        { user: 'josh', body: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } },
        resStub,
      );
      expect(status).toBe(201);
      const sentSubject = (sendMail as any).mock.calls[0][0].subject;
      expect(sentSubject).toBe('Performance Inquiry for The Spot on Kirk');
      expect(sentSubject.split('The Spot on Kirk')).toHaveLength(2); // exactly one occurrence
    });

    it('sendBatch: every sent email\'s subject names its own venue', async () => {
      asApprover();
      (venueModel as any).findById = vi.fn()
        .mockResolvedValueOnce(validVenue({ name: 'Venue One' }))
        .mockResolvedValueOnce(validVenue({ name: 'Venue Two' }));
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate({ subject: 'Performance Inquiry: Josh and Maria' })));
      await c.sendBatch(
        { user: 'josh', body: { venueIds: [oid(), oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } },
        resStub,
      );
      expect(status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect((sendMail as any).mock.calls[0][0].subject).toBe('Performance Inquiry: Josh and Maria — Venue One');
      expect((sendMail as any).mock.calls[1][0].subject).toBe('Performance Inquiry: Josh and Maria — Venue Two');
    });

    it('previewByVenue (single form): appends the venue name when the template subject has no token', async () => {
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate({ subject: 'Performance Inquiry: Josh and Maria' })));
      await c.previewByVenue({ user: 'a', query: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(status).toBe(200);
      expect(payload.subject).toBe('Performance Inquiry: Josh and Maria — The Spot on Kirk');
    });

    it('previewByVenue (batch form): each preview names its own venue in the subject', async () => {
      const id1 = oid();
      const id2 = oid();
      (venueModel as any).findById = vi.fn()
        .mockResolvedValueOnce(validVenue({ name: 'Venue One' }))
        .mockResolvedValueOnce(validVenue({ name: 'Venue Two' }));
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate({ subject: 'Performance Inquiry: Josh and Maria' })));
      await c.previewByVenue({ user: 'a', query: { venueIds: `${id1},${id2}`, targetDates: 'Sept 25-27' } }, resStub);
      expect(status).toBe(200);
      expect(payload[0].subject).toBe('Performance Inquiry: Josh and Maria — Venue One');
      expect(payload[1].subject).toBe('Performance Inquiry: Josh and Maria — Venue Two');
    });

    it('advanceCadence: a due EMAIL follow-up names the venue in the subject', async () => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      c.model.find = vi.fn(() => Promise.resolve([{
        _id: 'o1', venueId: oid(), sentAt: new Date('2026-06-01T12:00:00Z'), step: 1, targetDates: 'Aug 14-16', followUps: [],
      }]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(status).toBe(200);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const sentSubject = (sendMail as any).mock.calls[0][0].subject;
      expect(sentSubject).toContain('The Spot on Kirk');
    });
  });

  describe('customIntro + customBody (#903, supersedes #900)', () => {
    const body = () => ({ venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND, bookingPeriod: 'August' });

    it('sendPitch: both absent leaves the rendered html byte-for-byte unchanged (un-migrated template, no marker)', async () => {
      asApprover();
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect(status).toBe(201);
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html).toBe(
        '<p>Hi Pat, we are booking our August run and want Aug 14-16 at The Spot on Kirk.</p>'
          + '\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin-top:16px;">'
          + '<tr><td style="text-align:center;">'
          + '<img src="cid:footerphoto" width="320" alt="Josh and Maria performing" '
          + 'style="width:320px;max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto;"></td></tr></table>',
      );
    });

    it('sendPitch: both absent on a migrated (marker-carrying) template is also byte-for-byte unchanged', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch({ user: 'josh', body: body() }, resStub);
      expect(status).toBe(201);
      const html = (sendMail as any).mock.calls[0][0].html;
      // introHtml ("Hi Pat,") + bodyHtml with the marker stripped to '' reproduces
      // exactly the same copy the pre-#903 single-bodyHtml template would render.
      expect(html.startsWith('<p>Hi Pat,</p><p>we are booking our August run and want Aug 14-16 at The Spot on Kirk.</p>')).toBe(true);
      expect(html).not.toContain('[Custom Body]');
    });

    it('sendPitch: customIntro REPLACES the template intro — default intro is not also emitted (kills the #900 double-greeting)', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customIntro: 'We stopped in Wednesday and left a card.' } },
        resStub,
      );
      expect(status).toBe(201);
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html.indexOf('<p>We stopped in Wednesday and left a card.</p>')).toBe(0);
      expect(html).not.toContain('Hi Pat,'); // default intro NOT emitted alongside customIntro
      expect(html).toContain('we are booking our August run');
    });

    it('sendPitch: customBody is INSERTED at the [Custom Body] marker, template intro stays intact', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customBody: 'Loved your open mic last week!' } },
        resStub,
      );
      expect(status).toBe(201);
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html.startsWith('<p>Hi Pat,</p><p>Loved your open mic last week!</p><p>we are booking our August run')).toBe(true);
    });

    it('sendPitch: customIntro and customBody together — replace + insert, no double-greeting', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        {
          user: 'josh',
          body: { ...body(), customIntro: 'Hey Pat, following up!', customBody: 'We met at the farmers market.' },
        },
        resStub,
      );
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html.indexOf('<p>Hey Pat, following up!</p>')).toBe(0);
      expect(html).not.toContain('Hi Pat,');
      expect(html).toContain('<p>We met at the farmers market.</p><p>we are booking our August run');
      // cc / tracking / cadence stay intact regardless of the custom slots.
      expect((sendMail as any).mock.calls[0][0].cc).toEqual(['joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com']);
      const rec = (c.model.create as any).mock.calls[0][0];
      expect(rec.status).toBe('sent');
      expect(rec.nextTouchDue).toBeInstanceOf(Date);
    });

    it('sendPitch: a customBody supplied against an un-migrated (marker-less) template is appended, never dropped', async () => {
      asApprover();
      await c.sendPitch({ user: 'josh', body: { ...body(), customBody: 'We stopped in Wednesday and left a card.' } }, resStub);
      expect(status).toBe(201);
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html).toContain('Hi Pat, we are booking our August run');
      expect(html).toContain('<p>We stopped in Wednesday and left a card.</p>');
      // appended after the body, not prepended (the #900 behavior this supersedes).
      expect(html.indexOf('<p>We stopped in Wednesday and left a card.</p>')).toBeGreaterThan(html.indexOf('Hi Pat'));
    });

    it('sendPitch: blank/whitespace-only customIntro and customBody are treated as absent', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch({ user: 'josh', body: { ...body(), customIntro: '   ', customBody: '  ' } }, resStub);
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html.startsWith('<p>Hi Pat,</p><p>we are booking our August run')).toBe(true);
    });

    it('sendPitch: customIntro is HTML-escaped', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customIntro: 'Q&A: is "5pm" ok? <script>bad()</script>' } },
        resStub,
      );
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html).toContain('Q&amp;A: is &quot;5pm&quot; ok? &lt;script&gt;bad()&lt;/script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('sendPitch: customBody is HTML-escaped', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customBody: 'Q&A: is "5pm" ok? <script>bad()</script>' } },
        resStub,
      );
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html).toContain('Q&amp;A: is &quot;5pm&quot; ok? &lt;script&gt;bad()&lt;/script&gt;');
      expect(html).not.toContain('<script>');
    });

    it('sendPitch: a multi-line customBody renders as multiple paragraphs with <br> for single breaks', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customBody: 'Line one\nLine two\n\nSecond paragraph' } },
        resStub,
      );
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html).toContain('<p>Line one<br>Line two</p>\n<p>Second paragraph</p>');
    });

    it('sendPitch: a multi-line customIntro renders as multiple paragraphs with <br> for single breaks', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendPitch(
        { user: 'josh', body: { ...body(), customIntro: 'Line one\nLine two\n\nSecond paragraph' } },
        resStub,
      );
      const html = (sendMail as any).mock.calls[0][0].html;
      expect(html.indexOf('<p>Line one<br>Line two</p>\n<p>Second paragraph</p>')).toBe(0);
    });

    it('sendBatch: threads customIntro + customBody to every venue in the batch', async () => {
      asApprover();
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.sendBatch(
        {
          user: 'josh',
          body: {
            venueIds: [oid(), oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND,
            customIntro: 'Hey again!', customBody: 'Loved your open mic last week!',
          },
        },
        resStub,
      );
      expect(status).toBe(200);
      expect(payload.sent).toBe(2);
      expect((sendMail as any).mock.calls[0][0].html.indexOf('<p>Hey again!</p>')).toBe(0);
      expect((sendMail as any).mock.calls[0][0].html).toContain('<p>Loved your open mic last week!</p>');
      expect((sendMail as any).mock.calls[1][0].html).toContain('<p>Loved your open mic last week!</p>');
    });

    it('sendBatch: both absent leaves batch sends unchanged', async () => {
      asApprover();
      await c.sendBatch({ user: 'josh', body: { venueIds: [oid()], targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect((sendMail as any).mock.calls[0][0].html.startsWith('<p>Hi Pat')).toBe(true);
    });

    it('previewByVenue (single form): reflects customIntro + customBody without sending', async () => {
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      await c.previewByVenue(
        {
          user: 'a',
          query: {
            venueId: oid(), targetDates: 'Aug 14-16', customIntro: 'Hi there again,', customBody: 'We met at the farmers market.',
          },
        },
        resStub,
      );
      expect(status).toBe(200);
      expect(sendMail).not.toHaveBeenCalled();
      expect(payload.html.indexOf('<p>Hi there again,</p>')).toBe(0);
      expect(payload.html).toContain('<p>We met at the farmers market.</p>');
      expect(payload.html).not.toContain('Hi Pat,');
    });

    it('previewByVenue (batch form): reflects customIntro + customBody per venue', async () => {
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(templateWithSlots()));
      const id1 = oid();
      await c.previewByVenue(
        {
          user: 'a',
          query: {
            venueIds: id1, targetDates: 'Sept 25-27', customIntro: 'Following up,', customBody: 'Card left at the bar.',
          },
        },
        resStub,
      );
      expect(status).toBe(200);
      expect(payload[0].body.indexOf('<p>Following up,</p>')).toBe(0);
      expect(payload[0].body).toContain('<p>Card left at the bar.</p>');
    });

    it('previewByVenue: both absent leaves preview unchanged', async () => {
      await c.previewByVenue({ user: 'a', query: { venueId: oid(), targetDates: 'Aug 14-16', targetWeekend: VALID_WEEKEND } }, resStub);
      expect(payload.html.startsWith('<p>Hi Pat')).toBe(true);
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
      expect((upd as any).mock.calls[0][1].nextTouchDue).toBeNull();
    });

    it('leaves nextTouchDue untouched when no terminal status is set', async () => {
      const id = oid();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateOutreach({ user: 'josh', params: { id }, body: { gmailThreadId: 't9' } }, resStub);
      expect((upd as any).mock.calls[0][1]).not.toHaveProperty('nextTouchDue');
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

  describe('deleteOutreach (#857)', () => {
    it('403s without the outreach:delete capability', async () => {
      asAgent(['outreach:edit']);
      await c.deleteOutreach({ user: 'a', params: { id: oid() } }, resStub);
      expect(status).toBe(403);
    });

    it('400s on an invalid id', async () => {
      await c.deleteOutreach({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('deletes a found record', async () => {
      const id = oid();
      const del = vi.fn(() => Promise.resolve({ _id: id, status: 'sent' }));
      c.model.findByIdAndDelete = del;
      await c.deleteOutreach({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(del).toHaveBeenCalledWith(id);
      expect(payload._id).toBe(id);
    });

    it('400s when the record is not found', async () => {
      c.model.findByIdAndDelete = vi.fn(() => Promise.resolve(null));
      await c.deleteOutreach({ user: 'a', params: { id: oid() } }, resStub);
      expect(status).toBe(400);
    });

    it('500s when the delete throws', async () => {
      c.model.findByIdAndDelete = vi.fn(() => Promise.reject(new Error('db down')));
      await c.deleteOutreach({ user: 'a', params: { id: oid() } }, resStub);
      expect(status).toBe(500);
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

    it('sends a due EMAIL follow-up (step 1 -> day-3 touch) and reschedules', async () => {
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(status).toBe(200);
      expect(payload).toMatchObject({ processed: 1, sent: 1, called: 0, parked: 0, skipped: 0 });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(createCallTaskEvent).not.toHaveBeenCalled();
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.step).toBe(2);
      expect(upd.nextTouchDue).toBeInstanceOf(Date);
      expect(upd.followUps).toHaveLength(1);
      expect(upd.followUps[0]).toMatchObject({ step: 2, type: 'email', messageId: 'mid-123' });
    });

    it('creates a CALL task (step 2 -> day-7 touch) instead of an email', async () => {
      c.model.find = vi.fn(() => Promise.resolve([dueRecord({ step: 2 })]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, called: 1, sent: 0, skipped: 0 });
      expect(createCallTaskEvent).toHaveBeenCalledTimes(1);
      expect(sendMail).not.toHaveBeenCalled();
      const arg = (createCallTaskEvent.mock.calls[0] as any)[0];
      expect(arg.title).toContain('The Spot on Kirk');
      expect(arg.scriptBody).toContain('Salem, VA');
      expect(arg.date).toBeInstanceOf(Date);
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.step).toBe(3);
      expect(upd.followUps[0]).toMatchObject({ step: 3, type: 'call', eventId: 'evt-1' });
    });

    it('skips a CALL touch when the calendar insert fails (no crash)', async () => {
      createCallTaskEvent.mockRejectedValueOnce(new Error('google down'));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord({ step: 2 })]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, called: 0 });
    });

    it('parks an exhausted sequence as no-response (no touch)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([dueRecord({ step: 5 })]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, parked: 1 });
      expect(sendMail).not.toHaveBeenCalled();
      expect(createCallTaskEvent).not.toHaveBeenCalled();
      const upd = (c.model.findByIdAndUpdate as any).mock.calls[0][1];
      expect(upd.status).toBe('no-response');
      expect(upd.nextTouchDue).toBeNull();
    });

    it('skips a record whose venue is archived', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, sent: 0 });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('skips an EMAIL touch when its venue has no email', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: '' })));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, sent: 0 });
      expect(sendMail).not.toHaveBeenCalled();
    });

    // #974 — the sendability guard applies to the cadence too: an
    // invalid-format primary (not just an empty one) skips the touch.
    it('skips an EMAIL touch when its venue primary email is not a valid format (#974)', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ email: 'not-an-email' })));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, sent: 0 });
      expect(sendMail).not.toHaveBeenCalled();
    });

    // #974 (reshaped 2026-07-18 — secondary rides in Cc, not To) — applies to
    // follow-up touches too.
    it('CCs secondaryEmail (never To) on a follow-up when the venue has one (#974)', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ secondaryEmail: 'chelsea@slowplaybrewing.com' })));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, sent: 1 });
      expect((sendMail as any).mock.calls[0][0].to).toBe('booking@spotonkirk.com');
      expect((sendMail as any).mock.calls[0][0].cc).toEqual([
        'joshua.v.sherman@gmail.com', 'chemmariasherman@gmail.com', 'chelsea@slowplaybrewing.com',
      ]);
    });

    it('skips a record when its follow-up send fails', async () => {
      sendMail.mockRejectedValueOnce(new Error('smtp down'));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1 });
    });

    it('skips when the reschedule write fails after a send', async () => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db write')));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord()]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1 });
    });

    it('skips when parking write fails', async () => {
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db write')));
      c.model.find = vi.fn(() => Promise.resolve([dueRecord({ step: 5 })]));
      await c.advanceCadence({ user: 'a' }, resStub);
      expect(payload).toMatchObject({ processed: 1, skipped: 1, parked: 0 });
    });

    it('skips when the venue lookup throws', async () => {
      (venueModel as any).findById = vi.fn(() => Promise.reject(new Error('db')));
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

  describe('reply-detection (#825)', () => {
    describe('checkReplies', () => {
      it('403s without outreach:edit', async () => {
        asAgent(['outreach:create']);
        await c.checkReplies({ user: 'a' }, resStub);
        expect(status).toBe(403);
      });

      it('500s when the active-outreach query throws', async () => {
        c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
        await c.checkReplies({ user: 'a' }, resStub);
        expect(status).toBe(500);
      });

      it('reports nothing matched when there are no replies', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([]);
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 0, classified: 0, bounced: 0 });
      });

      it('marks a matched reply replied, stores the snippet + suggestion, and halts cadence', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{
          outreachId: 'o1', fromAddress: 'pat@v.com', repliedAt: new Date('2026-06-26'), snippet: 'We would love to!', gmailThreadId: 't9',
        }]);
        classifyReply.mockResolvedValue({ sentiment: 'positive', proposedBookingStatus: 'booking', model: 'claude-haiku-4-5' });
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 1, classified: 1, bounced: 0 });
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith('o1', expect.objectContaining({
          status: 'replied', replySnippet: 'We would love to!', gmailThreadId: 't9', nextTouchDue: null,
          suggestion: expect.objectContaining({ sentiment: 'positive' }),
        }));
      });

      it('counts a match without an AI suggestion as matched-not-classified', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{ outreachId: 'o1', repliedAt: new Date(), snippet: 'hi' }]);
        classifyReply.mockResolvedValue(null);
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 1, classified: 0, bounced: 0 });
      });

      it('skips a match that does not correspond to a scanned record', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{ outreachId: 'ghost', repliedAt: new Date(), snippet: 'hi' }]);
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 0, classified: 0, bounced: 0 });
      });

      it('swallows a per-record update failure without aborting the scan', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{ outreachId: 'o1', repliedAt: new Date(), snippet: 'hi' }]);
        c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('write fail')));
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 0, classified: 0, bounced: 0 });
      });

      // #825 bounce auto-flag: a bounced match auto-flags the venue + halts the
      // outreach deterministically, with NO AI suggestion involved.
      it('auto-flags the venue and halts the outreach on a bounce match, without classifying', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{
          outreachId: 'o1', fromAddress: 'mailer-daemon@x.com', repliedAt: new Date('2026-06-26'),
          snippet: 'Delivery failure notice.', gmailThreadId: 't9', isBounce: true,
        }]);
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 1, classified: 0, bounced: 1 });
        expect(classifyReply).not.toHaveBeenCalled();
        // #974 — contactVerified is gone; the bounce auto-flag now relies
        // solely on outreachEligible:false (also asserts the dropped field is
        // no longer written at all).
        expect(venueModel.findByIdAndUpdate).toHaveBeenCalledWith('v1', expect.objectContaining({
          outreachEligible: false,
        }));
        expect((venueModel.findByIdAndUpdate as any).mock.calls[0][1]).not.toHaveProperty('contactVerified');
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith('o1', expect.objectContaining({
          status: 'no-response', nextTouchDue: null, replyKind: 'bounce',
          replySnippet: 'Delivery failure notice.', gmailThreadId: 't9',
        }));
        expect(c.model.findByIdAndUpdate).not.toHaveBeenCalledWith('o1', expect.objectContaining({ suggestion: expect.anything() }));
      });

      it('swallows a bounce venue-write failure and still halts the outreach', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{
          outreachId: 'o1', repliedAt: new Date(), snippet: 'bounce', isBounce: true,
        }]);
        (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('venue write fail')));
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 1, classified: 0, bounced: 1 });
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith('o1', expect.objectContaining({ status: 'no-response' }));
      });

      it('swallows a bounce outreach-write failure without aborting the scan', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', messageId: '<m1@x>' }]));
        findReplies.mockResolvedValue([{
          outreachId: 'o1', repliedAt: new Date(), snippet: 'bounce', isBounce: true,
        }]);
        c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('write fail')));
        await c.checkReplies({ user: 'a' }, resStub);
        expect(payload).toEqual({ checked: 1, matched: 0, classified: 0, bounced: 0 });
      });
    });

    describe('listPendingReplies', () => {
      it('403s without any outreach capability', async () => {
        asAgent(['nope']);
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(403);
      });

      it('returns replied records with an unreviewed suggestion, plus bounce records', async () => {
        const recs = [{ _id: 'o1', suggestion: { sentiment: 'positive', reviewed: false } }];
        c.model.find = vi.fn(() => Promise.resolve(recs));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual(recs);
        expect(c.model.find).toHaveBeenCalledWith({
          $or: [
            { status: 'replied', suggestion: { $ne: null }, 'suggestion.reviewed': { $ne: true } },
            { replyKind: 'bounce' },
          ],
        });
      });

      // #974 — "not re-verified" now means outreachEligible is still false
      // (contactVerified is gone); recordBounce flips it false the moment a
      // bounce lands, so a venue that hasn't been re-vetted since stays pending.
      it('surfaces a bounce record while its venue still needs attention (active, not re-vetted)', async () => {
        const recs = [{ _id: 'o1', venueId: 'v1', status: 'no-response', replyKind: 'bounce' }];
        c.model.find = vi.fn(() => Promise.resolve(recs));
        (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ outreachEligible: false })));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual(recs);
      });

      // #825 option B (decision 2026-07-02): bounce items auto-clear from venue
      // state — no dismiss button. Three clear conditions:
      it('auto-clears a bounce item once its venue is archived', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', replyKind: 'bounce' }]));
        (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ status: 'archived' })));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual([]);
      });

      // #974 — "re-verified" is now "re-vetted" (outreachEligible flipped back
      // true) since contactVerified is gone; fixing the address and re-vetting
      // the venue is the SAME action Josh already has to take to put it back
      // in the outreach pool at all.
      it('auto-clears a bounce item once its venue is re-vetted (outreachEligible true again, #974)', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', replyKind: 'bounce' }]));
        (venueModel as any).findById = vi.fn(() => Promise.resolve(validVenue({ outreachEligible: true })));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual([]);
      });

      it('auto-clears a bounce item whose venue no longer exists', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'o1', venueId: 'v1', replyKind: 'bounce' }]));
        (venueModel as any).findById = vi.fn(() => Promise.resolve(null));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual([]);
      });

      it('keeps a bounce item pending when the venue lookup fails (never hide on a read error)', async () => {
        const recs = [{ _id: 'o1', venueId: 'v1', replyKind: 'bounce' }];
        c.model.find = vi.fn(() => Promise.resolve(recs));
        (venueModel as any).findById = vi.fn(() => Promise.reject(new Error('db read fail')));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual(recs);
      });

      it('leaves genuine reply-suggestion items untouched by the bounce auto-clear (no venue lookup)', async () => {
        const recs = [{ _id: 'o1', status: 'replied', suggestion: { sentiment: 'positive', reviewed: false } }];
        c.model.find = vi.fn(() => Promise.resolve(recs));
        (venueModel as any).findById = vi.fn(() => Promise.resolve(null)); // would clear a bounce; must not touch a reply
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(200);
        expect(payload).toEqual(recs);
        expect(venueModel.findById).not.toHaveBeenCalled();
      });

      it('500s when the query throws', async () => {
        c.model.find = vi.fn(() => Promise.reject(new Error('db')));
        await c.listPendingReplies({ user: 'a' }, resStub);
        expect(status).toBe(500);
      });
    });

    describe('applySuggestion', () => {
      const withSuggestion = (over = {}) => ({
        _id: oid(), venueId: oid(), suggestion: { proposedBookingStatus: 'booking', proposedInterested: true }, ...over,
      });

      it('403s without venue:edit', async () => {
        await c.applySuggestion({ user: 'a', params: { id: oid() }, body: {} }, resStub); // default agent lacks venue:edit
        expect(status).toBe(403);
      });

      it('400s on an invalid id', async () => {
        asAgent(['venue:edit']);
        await c.applySuggestion({ user: 'a', params: { id: 'nope' }, body: {} }, resStub);
        expect(status).toBe(400);
      });

      it('400s when the record is not found', async () => {
        asAgent(['venue:edit']);
        c.model.findById = vi.fn(() => Promise.resolve(null));
        await c.applySuggestion({ user: 'a', params: { id: oid() }, body: {} }, resStub);
        expect(status).toBe(400);
      });

      it('400s when there is no suggestion to apply', async () => {
        asAgent(['venue:edit']);
        c.model.findById = vi.fn(() => Promise.resolve({ _id: 'o1', venueId: 'v1' }));
        await c.applySuggestion({ user: 'a', params: { id: oid() }, body: {} }, resStub);
        expect(status).toBe(400);
      });

      it('writes the suggested venue fields and marks the suggestion reviewed', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: {} }, resStub);
        expect((venueModel as any).findByIdAndUpdate).toHaveBeenCalledWith(String(rec.venueId), expect.objectContaining({
          bookingStatus: 'booking', interested: true,
        }));
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(String(rec._id), expect.objectContaining({ 'suggestion.reviewed': true }));
        expect(status).toBe(200);
      });

      it('lets a Josh-edited body override the AI proposal', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { bookingStatus: 'booked', interested: false } }, resStub);
        expect((venueModel as any).findByIdAndUpdate).toHaveBeenCalledWith(String(rec.venueId), expect.objectContaining({
          bookingStatus: 'booked', interested: false,
        }));
      });

      it('400s on an invalid bookingStatus', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { bookingStatus: 'maybe' } }, resStub);
        expect(status).toBe(400);
      });

      it('dismiss reviews the suggestion WITHOUT writing the venue', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { dismiss: true } }, resStub);
        expect((venueModel as any).findByIdAndUpdate).not.toHaveBeenCalled();
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(String(rec._id), expect.objectContaining({ 'suggestion.reviewed': true }));
      });

      it('reopen reverts a false positive to sent + resumes cadence, no venue write', async () => {
        asAgent(['venue:edit']);
        const rec = {
          _id: oid(), venueId: oid(), step: 1, sentAt: new Date('2026-06-23T00:00:00Z'), status: 'replied', suggestion: { sentiment: 'needs-info' },
        };
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { reopen: true } }, resStub);
        expect((venueModel as any).findByIdAndUpdate).not.toHaveBeenCalled();
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(String(rec._id), expect.objectContaining({
          status: 'sent', repliedAt: null, replySnippet: null, suggestion: null,
        }));
        expect(status).toBe(200);
      });

      it('reopen works even when there is no suggestion (Haiku failed)', async () => {
        asAgent(['venue:edit']);
        const rec = { _id: oid(), venueId: oid(), step: 1, sentAt: new Date('2026-06-23T00:00:00Z'), status: 'replied' };
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { reopen: true } }, resStub);
        expect(status).toBe(200);
        expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(String(rec._id), expect.objectContaining({ status: 'sent' }));
      });

      it('500s when the reopen update throws', async () => {
        asAgent(['venue:edit']);
        const rec = { _id: oid(), venueId: oid(), step: 1, sentAt: new Date(), status: 'replied', suggestion: {} };
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db')));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: { reopen: true } }, resStub);
        expect(status).toBe(500);
      });

      it('500s when the venue write throws', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db')));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: {} }, resStub);
        expect(status).toBe(500);
      });

      it('500s when the suggestion-reviewed update throws', async () => {
        asAgent(['venue:edit']);
        const rec = withSuggestion();
        c.model.findById = vi.fn(() => Promise.resolve(rec));
        c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db')));
        await c.applySuggestion({ user: 'a', params: { id: String(rec._id) }, body: {} }, resStub);
        expect(status).toBe(500);
      });
    });
  });

  describe('performSend logs a venue timeline touch (#898)', () => {
    it('appends an email touch with templateType + targetWeekend on sendPitch', async () => {
      asApprover();
      c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: 'o42', ...doc }));
      const venueUpd = vi.fn(() => Promise.resolve({}));
      (venueModel as any).findByIdAndUpdate = venueUpd;
      const venue = validVenue();
      (venueModel as any).findById = vi.fn(() => Promise.resolve(venue));
      await c.sendPitch({
        user: 'josh', body: { venueId: venue._id, targetDates: 'Sept 25-27', targetWeekend: VALID_WEEKEND },
      }, resStub);
      expect(status).toBe(201);
      const touchCall = (venueUpd.mock.calls as any[]).find((call: any) => call[1].$push) as any;
      expect(touchCall[0]).toBe(String(venue._id));
      expect(touchCall[1].$push.touches).toMatchObject({
        type: 'email', templateType: 'Originals', outreachId: 'o42',
        targetWeekend: { start: new Date(VALID_WEEKEND.start), end: new Date(VALID_WEEKEND.end) },
      });
    });

    it('does not fail the send when the venue touch write throws', async () => {
      asApprover();
      c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: 'o43', ...doc }));
      (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('venue down')));
      await c.sendPitch({
        user: 'josh', body: { venueId: oid(), targetDates: 'Sept 25-27', targetWeekend: VALID_WEEKEND },
      }, resStub);
      expect(status).toBe(201);
    });
  });

  describe('recordOutcome (#898) — the single choke point (#923)', () => {
    const outreachRec = (over = {}) => ({
      _id: oid(), venueId: oid(), status: 'sent', targetWeekend: { start: new Date(VALID_WEEKEND.start), end: new Date(VALID_WEEKEND.end) }, ...over,
    });

    beforeEach(() => {
      asAgent(['outreach:edit']);
    });

    it('403s without outreach:edit', async () => {
      asAgent(['outreach:create']);
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(403);
    });

    it('400s on an invalid id', async () => {
      await c.recordOutcome({ user: 'a', params: { id: 'bad' }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(400);
    });

    it('400s on an invalid/missing status', async () => {
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status must be one of');
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'sent' } }, resStub);
      expect(status).toBe(400);
    });

    it('400s a booked outcome with no bookedDate', async () => {
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'booked' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('bookedDate');
    });

    it('400s a booked outcome with an invalid bookedDate', async () => {
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'booked', bookedDate: 'not-a-date' } }, resStub);
      expect(status).toBe(400);
    });

    it('400s when the record is not found', async () => {
      c.model.findById = vi.fn(() => Promise.resolve(null));
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(400);
    });

    it('500s when the load throws', async () => {
      c.model.findById = vi.fn(() => Promise.reject(new Error('db down')));
      await c.recordOutcome({ user: 'a', params: { id: oid() }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(500);
    });

    it('500s when the outreach update throws', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db down')));
      await c.recordOutcome({ user: 'a', params: { id: String(rec._id) }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(500);
    });

    it('400s when the outreach update returns nothing', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve(null));
      await c.recordOutcome({ user: 'a', params: { id: String(rec._id) }, body: { status: 'interested' } }, resStub);
      expect(status).toBe(400);
    });

    it('stamps status/outcomeAt/outcomeBy and nulls nextTouchDue on an interested outcome', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const upd = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      c.model.findByIdAndUpdate = upd;
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'interested', actor: 'josh' },
      }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(String(rec._id), expect.objectContaining({
        status: 'interested', outcomeBy: 'josh', nextTouchDue: null,
      }));
      expect((upd.mock.calls[0] as any)[1].outcomeAt).toBeInstanceOf(Date);
    });

    it('writes a venue timeline touch for the outcome', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const venueUpd = vi.fn(() => Promise.resolve({}));
      (venueModel as any).findByIdAndUpdate = venueUpd;
      await c.recordOutcome({ user: 'a', params: { id: String(rec._id) }, body: { status: 'interested', actor: 'josh' } }, resStub);
      expect(venueUpd).toHaveBeenCalledWith(String(rec.venueId), expect.objectContaining({
        $push: { touches: expect.objectContaining({ type: 'outcome', outcome: 'interested', actor: 'josh' }) },
      }));
    });

    // #980 — doNotContact is gone; not-interested now sets outreachEligible
    // false (the SOLE permanent stop/go gate) and appends a dated note.
    it('not-interested sets venue.outreachEligible false permanently and appends a dated note (#980)', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const venueUpd = vi.fn(() => Promise.resolve({}));
      (venueModel as any).findByIdAndUpdate = venueUpd;
      await c.recordOutcome({ user: 'a', params: { id: String(rec._id) }, body: { status: 'not-interested' } }, resStub);
      expect(status).toBe(200);
      expect(venueUpd).toHaveBeenCalledWith(String(rec.venueId), expect.objectContaining({ outreachEligible: false }));
      // The note-append call: a single pipeline update (array), never a
      // separate read-then-write — see appendVenueNote's header comment.
      const noteCall = venueUpd.mock.calls.find((call: any) => Array.isArray(call[1]));
      expect(noteCall).toBeTruthy();
      const pipeline = (noteCall as any)[1][0];
      const line = pipeline.$set.notes.$cond[2];
      expect(line).toContain('not-interested');
      expect(line).toContain('outreachEligible set to false');
    });

    // #980 — bookingStatus is no longer written here (it's derived purely
    // from actual linked-gig data now); bookedDate is unaffected.
    it('booked stamps bookedDate on the record + venue, WITHOUT touching bookingStatus (#980)', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const outreachUpd = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      c.model.findByIdAndUpdate = outreachUpd;
      const venueUpd = vi.fn(() => Promise.resolve({}));
      (venueModel as any).findByIdAndUpdate = venueUpd;
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'booked', bookedDate: '2026-09-26', actor: 'josh' },
      }, resStub);
      expect(status).toBe(200);
      expect((outreachUpd.mock.calls[0] as any)[1].bookedDate).toEqual(new Date('2026-09-26'));
      const bookedDateCall = venueUpd.mock.calls.find((call: any) => call[1] && call[1].bookedDate);
      expect(bookedDateCall).toBeTruthy();
      expect((bookedDateCall as any)[1]).not.toHaveProperty('bookingStatus');
      expect((bookedDateCall as any)[1].bookedDate).toEqual(new Date('2026-09-26'));
    });

    it('booked auto-flips every OTHER sent+overlapping record to target-filled (+ nextTouchDue null)', async () => {
      const rec = outreachRec();
      const other1 = { _id: oid(), venueId: oid(), status: 'sent' };
      const other2 = { _id: oid(), venueId: oid(), status: 'sent' };
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const outreachUpd = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      c.model.findByIdAndUpdate = outreachUpd;
      const findMock = vi.fn((q: any) => {
        // dedup/candidates use different filters elsewhere; the auto-flip query
        // excludes the booked record itself and matches status:'sent'.
        if (q._id && q._id.$ne === String(rec._id)) return Promise.resolve([other1, other2]);
        return Promise.resolve([]);
      });
      c.model.find = findMock;
      const venueUpd = vi.fn(() => Promise.resolve({}));
      (venueModel as any).findByIdAndUpdate = venueUpd;
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'booked', bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200);
      expect(findMock).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: String(rec._id) }, status: 'sent' }));
      const flipCalls = outreachUpd.mock.calls.filter((call: any) => call[1].status === 'target-filled');
      expect(flipCalls).toHaveLength(2);
      expect(flipCalls[0][1]).toMatchObject({ status: 'target-filled', nextTouchDue: null, outcomeBy: 'outcome-auto-flip' });
      // Each flipped record's OWN venue also gets a target-filled touch.
      expect(venueUpd).toHaveBeenCalledWith(String(other1.venueId), expect.objectContaining({
        $push: { touches: expect.objectContaining({ type: 'outcome', outcome: 'target-filled' }) },
      }));
      expect(venueUpd).toHaveBeenCalledWith(String(other2.venueId), expect.objectContaining({
        $push: { touches: expect.objectContaining({ type: 'outcome', outcome: 'target-filled' }) },
      }));
    });

    it('booked with no targetWeekend on the record skips the auto-flip entirely', async () => {
      const rec = outreachRec({ targetWeekend: undefined });
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      c.model.findByIdAndUpdate = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      const findMock = vi.fn(() => Promise.resolve([{ _id: oid(), venueId: oid(), status: 'sent' }]));
      c.model.find = findMock;
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'booked', bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200);
      expect(findMock).not.toHaveBeenCalled();
    });

    it('the primary outcome write still succeeds when the auto-flip lookup itself throws', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      c.model.findByIdAndUpdate = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      c.model.find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'booked', bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200);
    });

    it('a bad record in the auto-flip batch does not abort the rest', async () => {
      const rec = outreachRec();
      const other1 = { _id: oid(), venueId: oid(), status: 'sent' };
      const other2 = { _id: oid(), venueId: oid(), status: 'sent' };
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      c.model.find = vi.fn(() => Promise.resolve([other1, other2]));
      let calls = 0;
      c.model.findByIdAndUpdate = vi.fn((id: string, u: any) => {
        calls += 1;
        if (calls === 2) return Promise.reject(new Error('db down')); // fails flipping other1
        return Promise.resolve({ _id: id, ...u });
      });
      await c.recordOutcome({
        user: 'a', params: { id: String(rec._id) }, body: { status: 'booked', bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200); // the primary write (call 1) succeeded before the flip ran
    });

    it('target-filled can be recorded directly (no auto-flip side effects)', async () => {
      const rec = outreachRec();
      c.model.findById = vi.fn(() => Promise.resolve(rec));
      const outreachUpd = vi.fn((id: string, u: any) => Promise.resolve({ _id: id, ...u }));
      c.model.findByIdAndUpdate = outreachUpd;
      const findMock = vi.fn(() => Promise.resolve([]));
      c.model.find = findMock;
      await c.recordOutcome({ user: 'a', params: { id: String(rec._id) }, body: { status: 'target-filled' } }, resStub);
      expect(status).toBe(200);
      expect(findMock).not.toHaveBeenCalled(); // auto-flip only runs off a 'booked' recording
    });
  });
});

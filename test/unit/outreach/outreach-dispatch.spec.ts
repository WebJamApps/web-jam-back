/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';

const sendMail = vi.fn(() => Promise.resolve({ messageId: 'mid-123' }));
vi.mock('#src/lib/mailer.js', () => ({
  sendMail,
  default: { sendMail },
}));

const {
  default: controller,
  computeDraftFingerprint,
  wrapDarkEmail,
  checkApprovalsChanged,
  getUnsentVenueNames,
  UNKNOWN_VENUE_NAME,
} = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: venueApprovalModel } = await import('#src/model/outreach/outreach-venue-approval-facade.js');
const { default: draftApprovalModel } = await import('#src/model/outreach/outreach-draft-approval-facade.js');
const { default: outreachDispatchModel } = await import('#src/model/outreach/outreach-dispatch-facade.js');
const { default: gigModel } = await import('#src/model/gig/gig-facade.js');

const c = controller as any;
const oid = () => new mongoose.Types.ObjectId().toString();

describe('Outreach Batch Dispatch — Preflight, Stored State & Time-Limited Sends (web-jam-back#1120)', () => {
  let status = 0;
  let payload: any;

  const resStub: any = {
    status: (s: number) => {
      status = s;
      return {
        json: (obj: any) => { payload = obj; return obj; },
      };
    },
  };

  const VALID_WEEKEND = { start: '2026-10-16', end: '2026-10-18' };
  const WEEKEND_STR = '2026-10-16-to-2026-10-18';

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

  const FOOTER_HTML = '\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin-top:16px;">'
    + '<tr><td style="text-align:center;">'
    + '<img src="cid:footerphoto" width="320" alt="Josh and Maria performing" '
    + 'style="width:320px;max-width:100%;height:auto;border-radius:8px;display:block;margin:0 auto;"></td></tr></table>';

  const validTemplate = (over = {}) => ({
    type: 'Originals',
    subject: 'Inquiry: [Venue Name]',
    bodyHtml: '<p>Hi [Contact Name], booking for [Target Dates].</p>',
    footerPhotoRef: 'footer-josh-maria',
    ...over,
  });

  const asApprover = () => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges: ['outreach:approve'] }));
  };

  const asAgent = (privileges = ['outreach:create', 'outreach:edit']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges, isAgent: true }));
  };

  const asNonOutreach = () => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges: ['venue:view'] }));
  };

  beforeEach(() => {
    status = 0;
    payload = undefined;
    vi.restoreAllMocks();
    sendMail.mockClear();
    sendMail.mockResolvedValue({ messageId: 'mid-123' });
    c.nowFn = () => Date.now();
    (gigModel as any).find = vi.fn(() => Promise.resolve([]));
    (gigModel as any).findOne = vi.fn(() => Promise.resolve(null));
    (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
    (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
    (venueApprovalModel as any).findLatestOne = vi.fn((q: any) => (venueApprovalModel as any).findOne(q));
    (draftApprovalModel as any).findLatestOne = vi.fn((q: any) => (draftApprovalModel as any).findOne(q));
    (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(null));
    (outreachDispatchModel as any).create = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
    (outreachDispatchModel as any).findOneAndUpdate = vi.fn(() => Promise.resolve({}));
    (templateModel as any).find = vi.fn(() => Promise.resolve([validTemplate()]));
    (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate()));
    (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
    c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
    c.model.findOne = vi.fn(() => Promise.resolve(null));
    c.model.find = vi.fn(() => Promise.resolve([]));
  });

  describe('Helper Functions: checkApprovalsChanged and getUnsentVenueNames', () => {
    it('checkApprovalsChanged returns true when approval IDs differ', () => {
      const vId = oid();
      const dId = oid();
      const dispatch = { venueApprovalId: vId, draftApprovalId: dId, venueIds: ['v1'] };
      const venueApproval = { _id: oid(), venueIds: ['v1'] };
      const draftApproval = { _id: dId };
      expect(checkApprovalsChanged(dispatch, venueApproval, draftApproval, ['v1'])).toBe(true);
    });

    it('checkApprovalsChanged returns true when updated_at timestamps differ', () => {
      const vId = oid();
      const dId = oid();
      const t1 = new Date('2026-10-01T12:00:00Z');
      const t2 = new Date('2026-10-01T12:05:00Z');
      const dispatch = {
        venueApprovalId: vId,
        draftApprovalId: dId,
        venueApprovalUpdatedAt: t1,
        draftApprovalUpdatedAt: t1,
        venueIds: ['v1'],
      };
      const venueApproval = { _id: vId, updated_at: t2, venueIds: ['v1'] };
      const draftApproval = { _id: dId, updated_at: t1 };
      expect(checkApprovalsChanged(dispatch, venueApproval, draftApproval, ['v1'])).toBe(true);
    });

    it('checkApprovalsChanged returns true when venueIds array differs', () => {
      const vId = oid();
      const dId = oid();
      const t1 = new Date('2026-10-01T12:00:00Z');
      const dispatch = {
        venueApprovalId: vId,
        draftApprovalId: dId,
        venueApprovalUpdatedAt: t1,
        draftApprovalUpdatedAt: t1,
        venueIds: ['v1', 'v2'],
      };
      const venueApproval = { _id: vId, updated_at: t1, venueIds: ['v1', 'v3'] };
      const draftApproval = { _id: dId, updated_at: t1 };
      expect(checkApprovalsChanged(dispatch, venueApproval, draftApproval, ['v1', 'v2'])).toBe(true);
    });

    it('checkApprovalsChanged returns false when approvals match dispatch records exactly', () => {
      const vId = oid();
      const dId = oid();
      const t1 = new Date('2026-10-01T12:00:00Z');
      const dispatch = {
        venueApprovalId: vId,
        draftApprovalId: dId,
        venueApprovalUpdatedAt: t1,
        draftApprovalUpdatedAt: t1,
        venueIds: ['v1', 'v2'],
      };
      const venueApproval = { _id: vId, updated_at: t1, venueIds: ['v1', 'v2'] };
      const draftApproval = { _id: dId, updated_at: t1 };
      expect(checkApprovalsChanged(dispatch, venueApproval, draftApproval, ['v1', 'v2'])).toBe(false);
    });

    it('getUnsentVenueNames looks up names and falls back to UNKNOWN_VENUE_NAME on DB failure', async () => {
      const id1 = oid();
      const id2 = oid();
      (venueModel as any).find = vi.fn(() => Promise.resolve([
        { _id: id1, name: 'The Mill' },
      ]));
      const names = await getUnsentVenueNames([id1, id2]);
      expect(names).toEqual(['The Mill', UNKNOWN_VENUE_NAME]);

      (venueModel as any).find = vi.fn(() => Promise.reject(new Error('DB disconnect')));
      const fallbackNames = await getUnsentVenueNames([id1, id2]);
      expect(fallbackNames).toEqual([id1, id2]);
    });
  });

  describe('POST /outreach/batch/preflight (web-jam-back#1120, D-74, D-75)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { venueIds: [oid()] } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(401);
    });

    it('rejects unauthorized users without outreach capabilities (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), body: { venueIds: [oid()] } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(403);
    });

    it('rejects empty or missing venueIds (400)', async () => {
      asApprover();
      const req: any = { user: oid(), body: { venueIds: [], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueIds (non-empty array) is required');
    });

    it('rejects invalid ObjectId strings in venueIds (400)', async () => {
      asApprover();
      const req: any = { user: oid(), body: { venueIds: ['not-an-oid'], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('invalid venueId');
    });

    it('rejects missing targetDates (400)', async () => {
      asApprover();
      const req: any = { user: oid(), body: { venueIds: [oid()], targetWeekend: VALID_WEEKEND } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetDates is required');
    });

    it('rejects missing or malformed targetWeekend (400)', async () => {
      asApprover();
      const req: any = { user: oid(), body: { venueIds: [oid()], targetDates: 'Oct 16-18', targetWeekend: { start: 'bad' } } };
      await c.preflightBatch(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetWeekend {start, end} is required');
    });

    describe('Condition 1: Full batch vetted and matching Gate 1 + Gate 2', () => {
      it('stores dispatch record under dispatchId, returns 200 { dispatchId, venueCount }, and sends NO emails', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue 1' });
        const v2 = validVenue({ _id: v2Id, name: 'Venue 2' });

        (venueModel as any).findById = vi.fn((id: string) => {
          if (id === v1Id) return Promise.resolve(v1);
          if (id === v2Id) return Promise.resolve(v2);
          return Promise.resolve(null);
        });

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue 1',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });
        const fp2 = computeDraftFingerprint({
          subject: 'Inquiry: Venue 2',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });

        const gate1Id = oid();
        const gate2Id = oid();
        const updatedAt = new Date('2026-10-01T12:00:00Z');
        const gate1Doc = { _id: gate1Id, batchId: 'batch-1', weekend: WEEKEND_STR, venueIds: [v1Id, v2Id], updated_at: updatedAt };
        const gate2Doc = {
          _id: gate2Id,
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          draftFingerprints: [
            { venueId: v1Id, fingerprint: fp1 },
            { venueId: v2Id, fingerprint: fp2 },
          ],
          updated_at: updatedAt,
        };

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate1Doc));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate2Doc));

        let storedDispatchDoc: any = null;
        (outreachDispatchModel as any).create = vi.fn((doc: any) => {
          storedDispatchDoc = { _id: oid(), ...doc };
          return Promise.resolve(storedDispatchDoc);
        });

        const req: any = {
          user: oid(),
          body: {
            batchId: 'batch-1',
            venueIds: [v1Id, v2Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
            templateType: 'Originals',
          },
        };

        await c.preflightBatch(req, resStub);

        expect(status).toBe(200);
        expect(payload.dispatchId).toBeDefined();
        expect(typeof payload.dispatchId).toBe('string');
        expect(payload.venueCount).toBe(2);
        expect(sendMail).not.toHaveBeenCalled();

        expect(storedDispatchDoc).not.toBeNull();
        expect(storedDispatchDoc.dispatchId).toBe(payload.dispatchId);
        expect(storedDispatchDoc.batchId).toBe('batch-1');
        expect(storedDispatchDoc.venueIds).toEqual([v1Id, v2Id]);
        expect(storedDispatchDoc.venueCount).toBe(2);
        expect(storedDispatchDoc.attemptedVenueIds).toEqual([]);
        expect(storedDispatchDoc.venueApprovalId).toBe(gate1Id);
        expect(storedDispatchDoc.draftApprovalId).toBe(gate2Id);
        expect(storedDispatchDoc.status).toBe('pending');
      });
    });

    describe('Condition 2: Condition does not hold (refused with 403, nothing stored, nothing sent)', () => {
      it('refuses (403) when Gate 1 approval is missing', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ draftFingerprints: [] }));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        const createMock = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
        (outreachDispatchModel as any).create = createMock;
        await c.preflightBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 1 venue-set approval is missing');
        expect(createMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (403) when Gate 2 draft approval is missing', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ venueIds: [v1Id] }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        const createMock = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
        (outreachDispatchModel as any).create = createMock;
        await c.preflightBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint approval is missing');
        expect(createMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (403) when batch venue set does not match Gate 1 approval', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ venueIds: [v1Id] }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ draftFingerprints: [] }));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id, v2Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        const createMock = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
        (outreachDispatchModel as any).create = createMock;
        await c.preflightBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 1 venue-set approval does not match batch venueIds');
        expect(createMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (403) when draft copy fingerprint diverges', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue 1' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ venueIds: [v1Id] }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'different-hash' }],
        }));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        const createMock = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
        (outreachDispatchModel as any).create = createMock;
        await c.preflightBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint mismatch');
        expect(createMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
      });
    });

    describe('Condition 3: Indeterminate check (fails closed, 500)', () => {
      it('refuses (500) when database error occurs during approval read', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('Connection lost')));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        const createMock = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
        (outreachDispatchModel as any).create = createMock;
        await c.preflightBatch(req, resStub);

        expect(status).toBe(500);
        expect(createMock).not.toHaveBeenCalled();
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (500) when storing dispatch doc throws database error', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue 1' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue 1',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ _id: oid(), venueIds: [v1Id] }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: oid(),
          draftFingerprints: [{ venueId: v1Id, fingerprint: fp1 }],
        }));

        (outreachDispatchModel as any).create = vi.fn(() => Promise.reject(new Error('Write concern error')));

        const req: any = {
          user: oid(),
          body: { batchId: 'batch-1', venueIds: [v1Id], targetDates: 'Oct 16-18', targetWeekend: VALID_WEEKEND },
        };

        await c.preflightBatch(req, resStub);

        expect(status).toBe(500);
        expect(payload.message).toContain('failed to store dispatch record');
        expect(sendMail).not.toHaveBeenCalled();
      });
    });
  });

  describe('POST /outreach/batch with dispatchId (web-jam-back#1120, D-74, D-75, D-76)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
      await c.sendBatch(req, resStub);
      expect(status).toBe(401);
    });

    it('rejects unauthorized users without outreach capabilities (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
      await c.sendBatch(req, resStub);
      expect(status).toBe(403);
    });

    it('allows agent accounts with outreach capabilities to pass the door gate', async () => {
      asAgent(['outreach:create', 'outreach:edit']);
      const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
      await c.sendBatch(req, resStub);
      // Passes authz, fails on unknown dispatchId (404)
      expect(status).toBe(404);
      expect(payload.message).toContain("unknown dispatchId 'disp-1'");
    });

    it('rejects empty or non-string dispatchId (400)', async () => {
      asApprover();
      const req1: any = { user: oid(), body: { dispatchId: '' } };
      await c.sendBatch(req1, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('dispatchId must be a non-empty string');

      const req2: any = { user: oid(), body: { dispatchId: '   ' } };
      await c.sendBatch(req2, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('dispatchId must be a non-empty string');
    });

    it('returns 404 when dispatchId is not found', async () => {
      asApprover();
      (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { dispatchId: 'unknown-uuid' } };
      await c.sendBatch(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("unknown dispatchId 'unknown-uuid'");
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('returns 500 when reading dispatch record fails with database error', async () => {
      asApprover();
      (outreachDispatchModel as any).findOne = vi.fn(() => Promise.reject(new Error('DB read failed')));
      const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
      await c.sendBatch(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('failed to read dispatch record');
      expect(sendMail).not.toHaveBeenCalled();
    });

    describe('Condition 2: Approvals changed or missing since preflight', () => {
      it('refuses (403), aborts dispatch, and reports unsent venues when Gate 1 approval was modified', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        const v2 = validVenue({ _id: v2Id, name: 'Venue Beta' });
        (venueModel as any).find = vi.fn(() => Promise.resolve([v1, v2]));

        const g1Id = oid();
        const g2Id = oid();
        const tPre = new Date('2026-10-01T12:00:00Z');
        const tPost = new Date('2026-10-01T12:10:00Z');

        const dispatchDoc = {
          dispatchId: 'disp-1',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          venueIds: [v1Id, v2Id],
          attemptedVenueIds: [],
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tPre,
          draftApprovalUpdatedAt: tPre,
          status: 'pending',
        };
        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        const updateSpy = vi.fn(() => Promise.resolve({}));
        (outreachDispatchModel as any).findOneAndUpdate = updateSpy;

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id,
          venueIds: [v1Id, v2Id],
          updated_at: tPost, // modified!
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id,
          draftFingerprints: [],
          updated_at: tPre,
        }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('approval records changed since preflight check');
        expect(payload.unsentVenues).toEqual(['Venue Alpha', 'Venue Beta']);
        expect(updateSpy).toHaveBeenCalledWith({ dispatchId: 'disp-1' }, { $set: { status: 'aborted' } });
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (403), aborts dispatch, and reports unsent venues when Gate 1 approval is deleted', async () => {
        asApprover();
        const v1Id = oid();
        (venueModel as any).find = vi.fn(() => Promise.resolve([validVenue({ _id: v1Id, name: 'Venue Alpha' })]));

        const dispatchDoc = {
          dispatchId: 'disp-1',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          venueIds: [v1Id],
          attemptedVenueIds: [],
          venueApprovalId: oid(),
          draftApprovalId: oid(),
          status: 'pending',
        };
        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        (outreachDispatchModel as any).findOneAndUpdate = vi.fn(() => Promise.resolve({}));

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null)); // deleted!
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ _id: oid(), draftFingerprints: [] }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('approval records missing since preflight check');
        expect(payload.unsentVenues).toEqual(['Venue Alpha']);
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses (403), aborts dispatch, and reports unsent venues when re-rendered copy diverges from fingerprint', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));
        (venueModel as any).find = vi.fn(() => Promise.resolve([v1]));

        const g1Id = oid();
        const g2Id = oid();
        const tDate = new Date('2026-10-01T12:00:00Z');

        const dispatchDoc = {
          dispatchId: 'disp-1',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          venueIds: [v1Id],
          attemptedVenueIds: [],
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tDate,
          draftApprovalUpdatedAt: tDate,
          status: 'pending',
        };
        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        const updateSpy = vi.fn(() => Promise.resolve({}));
        (outreachDispatchModel as any).findOneAndUpdate = updateSpy;

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id, venueIds: [v1Id], updated_at: tDate,
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id, draftFingerprints: [{ venueId: v1Id, fingerprint: 'diverged-fp' }], updated_at: tDate,
        }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint mismatch for venue');
        expect(payload.unsentVenues).toEqual(['Venue Alpha']);
        expect(updateSpy).toHaveBeenCalledWith({ dispatchId: 'disp-1' }, { $set: { status: 'aborted' } });
        expect(sendMail).not.toHaveBeenCalled();
      });
    });

    describe('Condition 1: Time-limited sends, progress tracking, and remaining count', () => {
      it('sends all venues and completes dispatch when within time limit', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue One' });
        const v2 = validVenue({ _id: v2Id, name: 'Venue Two' });

        (venueModel as any).findById = vi.fn((id: string) => {
          if (id === v1Id) return Promise.resolve(v1);
          if (id === v2Id) return Promise.resolve(v2);
          return Promise.resolve(null);
        });

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue One',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });
        const fp2 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Two',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });

        const g1Id = oid();
        const g2Id = oid();
        const tDate = new Date('2026-10-01T12:00:00Z');

        const dispatchDoc = {
          dispatchId: 'disp-1',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          targetDates: 'Oct 16-18',
          templateType: 'Originals',
          venueIds: [v1Id, v2Id],
          attemptedVenueIds: [],
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tDate,
          draftApprovalUpdatedAt: tDate,
          status: 'pending',
        };
        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        const updateSpy = vi.fn(() => Promise.resolve({}));
        (outreachDispatchModel as any).findOneAndUpdate = updateSpy;

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id, venueIds: [v1Id, v2Id], updated_at: tDate,
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id,
          draftFingerprints: [
            { venueId: v1Id, fingerprint: fp1 },
            { venueId: v2Id, fingerprint: fp2 },
          ],
          updated_at: tDate,
        }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-1' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(200);
        expect(payload.sent).toBe(2);
        expect(payload.skipped).toEqual([]);
        expect(payload.records).toHaveLength(2);
        expect(payload.remaining).toBe(0);
        expect(sendMail).toHaveBeenCalledTimes(2);

        expect(updateSpy).toHaveBeenCalledWith(
          { dispatchId: 'disp-1' },
          { $addToSet: { attemptedVenueIds: v1Id }, $set: { status: 'in_progress' } },
        );
        expect(updateSpy).toHaveBeenCalledWith(
          { dispatchId: 'disp-1' },
          { $addToSet: { attemptedVenueIds: v2Id }, $set: { status: 'in_progress' } },
        );
        expect(updateSpy).toHaveBeenCalledWith(
          { dispatchId: 'disp-1' },
          { $set: { status: 'completed' } },
        );
      });

      it('enforces 12-second time limit stop and enables resumption on subsequent call', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue One' });
        const v2 = validVenue({ _id: v2Id, name: 'Venue Two' });

        (venueModel as any).findById = vi.fn((id: string) => {
          if (id === v1Id) return Promise.resolve(v1);
          if (id === v2Id) return Promise.resolve(v2);
          return Promise.resolve(null);
        });

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue One',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });
        const fp2 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Two',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });

        const g1Id = oid();
        const g2Id = oid();
        const tDate = new Date('2026-10-01T12:00:00Z');

        // Setup clock control:
        // call 1 starts at t=1000.
        // venue 1 sends.
        // before venue 2 is checked, clock advances to t=13001 (12001 ms elapsed >= 12000).
        let currentClock = 1000;
        c.nowFn = () => currentClock;

        const dispatchDoc: any = {
          dispatchId: 'disp-timed',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          targetDates: 'Oct 16-18',
          templateType: 'Originals',
          venueIds: [v1Id, v2Id],
          attemptedVenueIds: [],
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tDate,
          draftApprovalUpdatedAt: tDate,
          status: 'pending',
        };

        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        (outreachDispatchModel as any).findOneAndUpdate = vi.fn((_q: any, update: any) => {
          if (update.$addToSet?.attemptedVenueIds) {
            dispatchDoc.attemptedVenueIds.push(update.$addToSet.attemptedVenueIds);
          }
          if (update.$set?.status) {
            dispatchDoc.status = update.$set.status;
          }
          return Promise.resolve(dispatchDoc);
        });

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id, venueIds: [v1Id, v2Id], updated_at: tDate,
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id,
          draftFingerprints: [
            { venueId: v1Id, fingerprint: fp1 },
            { venueId: v2Id, fingerprint: fp2 },
          ],
          updated_at: tDate,
        }));

        sendMail.mockImplementationOnce(() => {
          currentClock += 12_001; // simulate send taking 12 seconds
          return Promise.resolve({ messageId: 'mid-1' });
        });

        // First call: should send venue 1, stop before venue 2, report remaining: 1
        const req1: any = { user: oid(), body: { dispatchId: 'disp-timed' } };
        await c.sendBatch(req1, resStub);

        expect(status).toBe(200);
        expect(payload.sent).toBe(1);
        expect(payload.remaining).toBe(1);
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(dispatchDoc.attemptedVenueIds).toContain(v1Id);
        expect(dispatchDoc.status).toBe('in_progress');

        // Reset clock for call 2
        currentClock = 20_000;
        sendMail.mockImplementationOnce(() => {
          currentClock += 500;
          return Promise.resolve({ messageId: 'mid-2' });
        });

        // Second call with same dispatchId: should pick up venue 2, send it, report remaining: 0
        const req2: any = { user: oid(), body: { dispatchId: 'disp-timed' } };
        await c.sendBatch(req2, resStub);

        expect(status).toBe(200);
        expect(payload.sent).toBe(1);
        expect(payload.remaining).toBe(0);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(dispatchDoc.attemptedVenueIds).toContain(v2Id);
        expect(dispatchDoc.status).toBe('completed');
      });

      it('handles skipped venues without retrying them on subsequent calls', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        // v1 is not outreach-eligible -> resolveBatchPitchItem fails at send time -> skipped
        const v1 = validVenue({ _id: v1Id, name: 'Venue Ineligible', outreachEligible: false });
        const v2 = validVenue({ _id: v2Id, name: 'Venue Two' });

        (venueModel as any).findById = vi.fn((id: string) => {
          if (id === v1Id) return Promise.resolve(v1);
          if (id === v2Id) return Promise.resolve(v2);
          return Promise.resolve(null);
        });

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Ineligible',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });
        const fp2 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Two',
          body: wrapDarkEmail(`<p>Hi Pat, booking for Oct 16-18.</p>${FOOTER_HTML}`),
        });

        const g1Id = oid();
        const g2Id = oid();
        const tDate = new Date('2026-10-01T12:00:00Z');

        const dispatchDoc: any = {
          dispatchId: 'disp-skip',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          targetDates: 'Oct 16-18',
          templateType: 'Originals',
          venueIds: [v1Id, v2Id],
          attemptedVenueIds: [],
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tDate,
          draftApprovalUpdatedAt: tDate,
          status: 'pending',
        };

        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        (outreachDispatchModel as any).findOneAndUpdate = vi.fn((_q: any, update: any) => {
          if (update.$addToSet?.attemptedVenueIds) {
            dispatchDoc.attemptedVenueIds.push(update.$addToSet.attemptedVenueIds);
          }
          if (update.$set?.status) {
            dispatchDoc.status = update.$set.status;
          }
          return Promise.resolve(dispatchDoc);
        });

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id, venueIds: [v1Id, v2Id], updated_at: tDate,
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id,
          draftFingerprints: [
            { venueId: v1Id, fingerprint: fp1 },
            { venueId: v2Id, fingerprint: fp2 },
          ],
          updated_at: tDate,
        }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-skip' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(200);
        expect(payload.sent).toBe(1);
        expect(payload.skipped).toHaveLength(1);
        expect(payload.skipped[0].venueId).toBe(v1Id);
        expect(payload.skipped[0].reason).toContain('not outreach-eligible');
        expect(payload.remaining).toBe(0);
        expect(dispatchDoc.attemptedVenueIds).toContain(v1Id);
        expect(dispatchDoc.attemptedVenueIds).toContain(v2Id);
        expect(dispatchDoc.status).toBe('completed');
      });

      it('returns remaining: 0 and sent: 0 when all venues were already attempted or pitched', async () => {
        asApprover();
        const v1Id = oid();
        const g1Id = oid();
        const g2Id = oid();
        const tDate = new Date('2026-10-01T12:00:00Z');

        const dispatchDoc = {
          dispatchId: 'disp-done',
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          targetWeekend: VALID_WEEKEND,
          targetDates: 'Oct 16-18',
          templateType: 'Originals',
          venueIds: [v1Id],
          attemptedVenueIds: [v1Id], // already attempted
          venueApprovalId: g1Id,
          draftApprovalId: g2Id,
          venueApprovalUpdatedAt: tDate,
          draftApprovalUpdatedAt: tDate,
          status: 'completed',
        };

        (outreachDispatchModel as any).findOne = vi.fn(() => Promise.resolve(dispatchDoc));
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g1Id, venueIds: [v1Id], updated_at: tDate,
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          _id: g2Id,
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp1' }],
          updated_at: tDate,
        }));

        const req: any = { user: oid(), body: { dispatchId: 'disp-done' } };
        await c.sendBatch(req, resStub);

        expect(status).toBe(200);
        expect(payload.sent).toBe(0);
        expect(payload.skipped).toEqual([]);
        expect(payload.records).toEqual([]);
        expect(payload.remaining).toBe(0);
        expect(sendMail).not.toHaveBeenCalled();
      });
    });
  });
});

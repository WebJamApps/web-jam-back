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
  validateVenueIds,
  resolveBatchIdentification,
  normalizeDraftFingerprints,
  isExactVenueSetMatch,
  extractApprovedFingerprints,
} = await import('#src/model/outreach/outreach-controller.js');
const { default: userModel } = await import('#src/model/user/user-facade.js');
const { default: venueModel } = await import('#src/model/venue/venue-facade.js');
const { default: templateModel } = await import('#src/model/template/template-facade.js');
const { default: venueApprovalModel } = await import('#src/model/outreach/outreach-venue-approval-facade.js');
const { default: draftApprovalModel } = await import('#src/model/outreach/outreach-draft-approval-facade.js');

const c = controller as any;
const oid = () => new mongoose.Types.ObjectId().toString();

describe('Outreach Batch Approvals — Gate 1 & Gate 2 (web-jam-back#1078)', () => {
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

  beforeEach(() => {
    status = 0;
    payload = undefined;
    vi.restoreAllMocks();
  });

  const asAgent = (privileges = ['outreach:create', 'outreach:edit']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  const asApprover = () => asAgent(['outreach:approve']);

  const asNonOutreach = () => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges: ['venue:view'] }));
  };

  describe('Gate 1: recordVenueApproval (POST /outreach/approval/venue-set)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { batchId: 'b1', venueIds: [oid()] } };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(401);
      expect(payload.message).toContain('user not found');
    });

    it('rejects unauthorized users without send capabilities (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), body: { batchId: 'b1', venueIds: [oid()] } };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(403);
    });

    it('rejects empty or missing venueIds (400)', async () => {
      asAgent();
      const req1: any = { user: oid(), body: { batchId: 'b1' } };
      await c.recordVenueApproval(req1, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueIds (non-empty array) is required');

      const req2: any = { user: oid(), body: { batchId: 'b1', venueIds: [] } };
      await c.recordVenueApproval(req2, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueIds (non-empty array) is required');
    });

    it('rejects invalid ObjectId strings in venueIds (400)', async () => {
      asAgent();
      const req: any = { user: oid(), body: { batchId: 'b1', venueIds: ['not-an-oid'] } };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('invalid venueId');
    });

    it('rejects when no batch identification is provided (400)', async () => {
      asAgent();
      const req: any = { user: oid(), body: { venueIds: [oid()] } };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('batchId, weekend, or targetWeekend is required');
    });

    it('creates a new Gate 1 venue approval record (201)', async () => {
      asApprover();
      const vId1 = oid();
      const vId2 = oid();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (venueApprovalModel as any).create = vi.fn((doc) => Promise.resolve({ _id: oid(), ...doc }));

      const req: any = {
        user: oid(),
        body: {
          batchId: 'batch-oct-16',
          weekend: '2026-10-16-to-2026-10-18',
          venueIds: [vId1, vId2],
          approver: 'Josh',
          notes: 'Approved all candidates',
        },
      };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(201);
      expect(payload.batchId).toBe('batch-oct-16');
      expect(payload.venueIds).toEqual([vId1, vId2]);
      expect(payload.approver).toBe('Josh');
      expect(payload.notes).toBe('Approved all candidates');
      expect(venueApprovalModel.create).toHaveBeenCalled();
    });

    it('updates an existing Gate 1 record on re-approval (200)', async () => {
      asApprover();
      const existingId = oid();
      const vId = oid();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ _id: existingId, batchId: 'batch-oct-16' }));
      (venueApprovalModel as any).findByIdAndUpdate = vi.fn((id, update) => Promise.resolve({ _id: id, ...update }));

      const req: any = {
        user: oid(),
        body: {
          batchId: 'batch-oct-16',
          venueIds: [vId],
          approver: 'Josh',
        },
      };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload._id).toBe(existingId);
      expect(payload.venueIds).toEqual([vId]);
      expect(venueApprovalModel.findByIdAndUpdate).toHaveBeenCalledWith(existingId, expect.any(Object));
    });

    it('derives batchId from targetWeekend when batchId is not explicitly given', async () => {
      asApprover();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (venueApprovalModel as any).create = vi.fn((doc) => Promise.resolve({ _id: oid(), ...doc }));

      const req: any = {
        user: oid(),
        body: {
          targetWeekend: { start: '2026-10-16', end: '2026-10-18' },
          venueIds: [oid()],
          approver: 'Josh',
        },
      };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(201);
      expect(payload.batchId).toBe('2026-10-16-to-2026-10-18');
      expect(payload.weekend).toBe('2026-10-16-to-2026-10-18');
    });

    it('returns 500 when database error occurs during record', async () => {
      asApprover();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('Mongo connection failed')));
      const req: any = { user: oid(), body: { batchId: 'b1', venueIds: [oid()], approver: 'Josh' } };
      await c.recordVenueApproval(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('Mongo connection failed');
    });
  });

  describe('Gate 1: getVenueApproval (GET /outreach/approval/venue-set/:batchId)', () => {
    it('rejects unauthorized users without any outreach caps (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), params: { batchId: 'b1' } };
      await c.getVenueApproval(req, resStub);
      expect(status).toBe(403);
    });

    it('rejects missing or empty batchId (400)', async () => {
      asAgent();
      const req: any = { user: oid(), params: { batchId: '   ' } };
      await c.getVenueApproval(req, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('batchId parameter is required');
    });

    it('returns 404 when venue approval record does not exist', async () => {
      asAgent();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), params: { batchId: 'missing-batch' } };
      await c.getVenueApproval(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("Gate 1 venue-set approval for batch 'missing-batch' not found");
    });

    it('returns 200 with the approval document when found', async () => {
      asAgent();
      const mockDoc = { batchId: 'batch-1', venueIds: [oid()], approver: 'Josh' };
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(mockDoc));
      const req: any = { user: oid(), params: { batchId: 'batch-1' } };
      await c.getVenueApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload.batchId).toBe('batch-1');
      expect(payload.approver).toBe('Josh');
    });

    it('returns 500 when database error occurs during find', async () => {
      asAgent();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('DB read error')));
      const req: any = { user: oid(), params: { batchId: 'batch-1' } };
      await c.getVenueApproval(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('DB read error');
    });
  });

  describe('Gate 2: recordDraftApproval (POST /outreach/approval/draft-fingerprints)', () => {
    it('rejects unauthenticated requests (401)', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: 'fp' }] } };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(401);
    });

    it('rejects unauthorized users without send capabilities (403)', async () => {
      asNonOutreach();
      const req: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: 'fp' }] } };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(403);
    });

    it('rejects missing or empty draftFingerprints (400)', async () => {
      asAgent();
      const req1: any = { user: oid(), body: { batchId: 'b1' } };
      await c.recordDraftApproval(req1, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('draftFingerprints (non-empty array or map) is required');

      const req2: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: [] } };
      await c.recordDraftApproval(req2, resStub);
      expect(status).toBe(400);
    });

    it('rejects invalid items in draftFingerprints (400)', async () => {
      asAgent();
      const reqNonObj: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: ['bad-item'] } };
      await c.recordDraftApproval(reqNonObj, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('each item in draftFingerprints must be an object');

      const reqBadVid: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: [{ venueId: 'invalid-id', fingerprint: 'f1' }] } };
      await c.recordDraftApproval(reqBadVid, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('invalid venueId in draftFingerprints');

      const reqEmptyFp: any = { user: oid(), body: { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: '  ' }] } };
      await c.recordDraftApproval(reqEmptyFp, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('fingerprint is required');
    });

    it('creates a new Gate 2 draft approval record from array (201)', async () => {
      asApprover();
      const vId = oid();
      const fp = computeDraftFingerprint('Hello booking contact, would love to play on Oct 16');
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (draftApprovalModel as any).create = vi.fn((doc) => Promise.resolve({ _id: oid(), ...doc }));

      const req: any = {
        user: oid(),
        body: {
          batchId: 'batch-oct-16',
          weekend: '2026-10-16-to-2026-10-18',
          draftFingerprints: [{ venueId: vId, fingerprint: fp, subject: 'Josh & Maria Music Performance Inquiry' }],
          approver: 'Josh',
        },
      };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(201);
      expect(payload.batchId).toBe('batch-oct-16');
      expect(payload.draftFingerprints).toHaveLength(1);
      expect(payload.draftFingerprints[0].venueId).toBe(vId);
      expect(payload.draftFingerprints[0].fingerprint).toBe(fp);
      expect(draftApprovalModel.create).toHaveBeenCalled();
    });

    it('creates a Gate 2 draft approval record from dictionary/map input (201)', async () => {
      asApprover();
      const vId = oid();
      const fp = computeDraftFingerprint('Map test body');
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (draftApprovalModel as any).create = vi.fn((doc) => Promise.resolve({ _id: oid(), ...doc }));

      const req: any = {
        user: oid(),
        body: {
          batchId: 'batch-map-1',
          fingerprints: { [vId]: fp },
          approver: 'Josh',
        },
      };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(201);
      expect(payload.draftFingerprints[0].venueId).toBe(vId);
      expect(payload.draftFingerprints[0].fingerprint).toBe(fp);
    });

    it('updates an existing Gate 2 record on re-approval (200)', async () => {
      asApprover();
      const existingId = oid();
      const vId = oid();
      const fp = computeDraftFingerprint('Updated copy');
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({ _id: existingId, batchId: 'batch-oct-16' }));
      (draftApprovalModel as any).findByIdAndUpdate = vi.fn((id, update) => Promise.resolve({ _id: id, ...update }));

      const req: any = {
        user: oid(),
        body: {
          batchId: 'batch-oct-16',
          draftFingerprints: [{ venueId: vId, fingerprint: fp }],
          approver: 'Josh',
        },
      };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload._id).toBe(existingId);
      expect(payload.draftFingerprints[0].fingerprint).toBe(fp);
    });

    it('returns 500 when database error occurs during draft record', async () => {
      asApprover();
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('Mongo write error')));
      const req: any = {
        user: oid(),
        body: { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: 'f1' }], approver: 'Josh' },
      };
      await c.recordDraftApproval(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('Mongo write error');
    });
  });

  describe('Gate 2: getDraftApproval (GET /outreach/approval/draft-fingerprints/:batchId)', () => {
    it('returns 404 when draft approval does not exist', async () => {
      asAgent();
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      const req: any = { user: oid(), params: { batchId: 'missing-batch' } };
      await c.getDraftApproval(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("Gate 2 draft fingerprint approval for batch 'missing-batch' not found");
    });

    it('returns 200 with the draft approval document when found', async () => {
      asAgent();
      const mockDoc = { batchId: 'batch-1', draftFingerprints: [{ venueId: oid(), fingerprint: 'fp1' }], approver: 'Josh' };
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(mockDoc));
      const req: any = { user: oid(), params: { batchId: 'batch-1' } };
      await c.getDraftApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload.batchId).toBe('batch-1');
      expect(payload.draftFingerprints).toHaveLength(1);
    });

    it('returns 500 on database error during draft read', async () => {
      asAgent();
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('DB read failure')));
      const req: any = { user: oid(), params: { batchId: 'batch-1' } };
      await c.getDraftApproval(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('DB read failure');
    });
  });

  describe('Combined read-back: getBatchApproval (GET /outreach/approval/:batchId)', () => {
    it('returns 404 when neither approval exists', async () => {
      asAgent();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));

      const req: any = { user: oid(), params: { batchId: 'batch-none' } };
      await c.getBatchApproval(req, resStub);
      expect(status).toBe(404);
      expect(payload.message).toContain("No approval records found for batch 'batch-none'");
    });

    it('returns partial status with complete: false when only Gate 1 exists', async () => {
      asAgent();
      const gate1Doc = { batchId: 'b1', venueIds: [oid()], approver: 'Josh' };
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate1Doc));
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));

      const req: any = { user: oid(), params: { batchId: 'b1' } };
      await c.getBatchApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload.batchId).toBe('b1');
      expect(payload.gate1).toEqual(gate1Doc);
      expect(payload.gate2).toBeNull();
      expect(payload.complete).toBe(false);
    });

    it('returns partial status with complete: false when only Gate 2 exists', async () => {
      asAgent();
      const gate2Doc = { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: 'fp' }], approver: 'Josh' };
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate2Doc));

      const req: any = { user: oid(), params: { batchId: 'b1' } };
      await c.getBatchApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload.gate1).toBeNull();
      expect(payload.gate2).toEqual(gate2Doc);
      expect(payload.complete).toBe(false);
    });

    it('returns complete: true when both Gate 1 and Gate 2 approvals exist', async () => {
      asAgent();
      const gate1Doc = { batchId: 'b1', venueIds: [oid()], approver: 'Josh' };
      const gate2Doc = { batchId: 'b1', draftFingerprints: [{ venueId: oid(), fingerprint: 'fp' }], approver: 'Josh' };
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate1Doc));
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate2Doc));

      const req: any = { user: oid(), params: { batchId: 'b1' } };
      await c.getBatchApproval(req, resStub);
      expect(status).toBe(200);
      expect(payload.gate1).toEqual(gate1Doc);
      expect(payload.gate2).toEqual(gate2Doc);
      expect(payload.complete).toBe(true);
    });

    it('returns 500 when database error occurs during combined read', async () => {
      asAgent();
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('Combined read failure')));
      const req: any = { user: oid(), params: { batchId: 'b1' } };
      await c.getBatchApproval(req, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('Combined read failure');
    });
  });

  describe('Model Helpers & Utilities', () => {
    it('computeDraftFingerprint returns SHA-256 hex string for string content', () => {
      const hash1 = computeDraftFingerprint('Hello World');
      const hash2 = computeDraftFingerprint('Hello World');
      const hash3 = computeDraftFingerprint('Different Content');
      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('computeDraftFingerprint returns SHA-256 hex string for { subject, body } object', () => {
      const hash = computeDraftFingerprint({ subject: 'Inquiry', body: 'Performance copy' });
      expect(hash).toHaveLength(64);
      const expected = computeDraftFingerprint('Inquiry\n\nPerformance copy');
      expect(hash).toBe(expected);
    });

    it('validateVenueIds validates arrays properly', () => {
      expect(validateVenueIds(null)).toEqual({ error: 'venueIds (non-empty array) is required' });
      expect(validateVenueIds([])).toEqual({ error: 'venueIds (non-empty array) is required' });
      expect(validateVenueIds(['invalid'])).toEqual({ error: "invalid venueId in venueIds: 'invalid'" });
      const valid = [oid(), oid()];
      expect(validateVenueIds(valid)).toEqual({ venueIds: valid });
    });

    it('resolveBatchIdentification derives from weekend, batchId, or targetWeekend', () => {
      expect(resolveBatchIdentification({})).toEqual({
        error: 'batchId, weekend, or targetWeekend is required to identify the batch',
      });
      expect(resolveBatchIdentification({ batchId: 'b-123' })).toEqual({
        batchId: 'b-123',
        weekend: undefined,
        tw: null,
      });
      expect(resolveBatchIdentification({ weekend: '2026-10-16-to-2026-10-18' })).toEqual({
        batchId: '2026-10-16-to-2026-10-18',
        weekend: '2026-10-16-to-2026-10-18',
        tw: null,
      });
    });

    it('normalizeDraftFingerprints handles array and dictionary inputs', () => {
      const vId = oid();
      expect(normalizeDraftFingerprints({})).toEqual({
        error: 'draftFingerprints (non-empty array or map) is required',
      });
      const arr = [{ venueId: vId, fingerprint: 'fp123', subject: 'Subj' }];
      expect(normalizeDraftFingerprints({ draftFingerprints: arr })).toEqual({
        fingerprints: arr,
      });
      expect(normalizeDraftFingerprints({ fingerprints: { [vId]: 'fp123' } })).toEqual({
        fingerprints: [{ venueId: vId, fingerprint: 'fp123' }],
      });
    });

    it('controller getVenueSetApproval and getDraftFingerprintsApproval query models', async () => {
      const venueDoc = { batchId: 'b-1' };
      const draftDoc = { batchId: 'b-1' };
      (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(venueDoc));
      (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(draftDoc));

      const vRes = await c.getVenueSetApproval('b-1');
      const dRes = await c.getDraftFingerprintsApproval('b-1');
      expect(vRes).toEqual(venueDoc);
      expect(dRes).toEqual(draftDoc);
    });

    it('facades support findOneAndDelete', async () => {
      const mockExec = vi.fn(() => Promise.resolve({ batchId: 'b-del' }));
      const mockLean = vi.fn(() => ({ exec: mockExec }));
      (venueApprovalModel.Schema as any).findOneAndDelete = vi.fn(() => ({ lean: mockLean }));
      (draftApprovalModel.Schema as any).findOneAndDelete = vi.fn(() => ({ lean: mockLean }));

      const vRes = await venueApprovalModel.findOneAndDelete({ batchId: 'b-del' });
      const dRes = await draftApprovalModel.findOneAndDelete({ batchId: 'b-del' });
      expect(vRes).toEqual({ batchId: 'b-del' });
      expect(dRes).toEqual({ batchId: 'b-del' });
    });
  });

  describe('Batch Dispatch Approval Guard (web-jam-back#1079, D-39, D-40, D-41, D-42, Step 6)', () => {
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

    const validTemplate = (over = {}) => ({
      type: 'Originals',
      subject: 'Inquiry: [Venue Name]',
      bodyHtml: '<p>Hi [Contact Name], booking for [Target Dates].</p>',
      ...over,
    });

    beforeEach(() => {
      sendMail.mockClear();
      sendMail.mockResolvedValue({ messageId: 'mid-123' });
      c.model.create = vi.fn((doc: any) => Promise.resolve({ _id: oid(), ...doc }));
      c.model.findOne = vi.fn(() => Promise.resolve(null)); // dedup guard
      (venueModel as any).findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      (templateModel as any).findOne = vi.fn(() => Promise.resolve(validTemplate()));
    });

    describe('Helper Functions: isExactVenueSetMatch & extractApprovedFingerprints', () => {
      it('isExactVenueSetMatch handles exact match regardless of order', () => {
        const id1 = oid();
        const id2 = oid();
        expect(isExactVenueSetMatch([id1, id2], [id1, id2])).toBe(true);
        expect(isExactVenueSetMatch([id1, id2], [id2, id1])).toBe(true);
      });

      it('isExactVenueSetMatch rejects duplicate or mismatched ids', () => {
        const id1 = oid();
        const id2 = oid();
        const id3 = oid();
        expect(isExactVenueSetMatch([id1, id2], [id1])).toBe(false);
        expect(isExactVenueSetMatch([id1], [id1, id2])).toBe(false);
        expect(isExactVenueSetMatch([id1, id2], [id1, id3])).toBe(false);
        expect(isExactVenueSetMatch([id1], [id1, id1])).toBe(false);
      });

      it('extractApprovedFingerprints extracts map from array and object formats', () => {
        const id1 = oid();
        const id2 = oid();
        const fromArray = extractApprovedFingerprints({
          draftFingerprints: [
            { venueId: id1, fingerprint: 'fp1' },
            null,
            { venueId: id2, fingerprint: 'fp2' },
          ],
        });
        expect(fromArray.get(id1)).toBe('fp1');
        expect(fromArray.get(id2)).toBe('fp2');
        expect(fromArray.size).toBe(2);

        const fromMap = extractApprovedFingerprints({
          fingerprints: { [id1]: 'fp1', [id2]: 'fp2' },
        });
        expect(fromMap.get(id1)).toBe('fp1');
        expect(fromMap.get(id2)).toBe('fp2');
      });
    });

    describe('Outcome 1: Both approvals present and matching (dispatch proceeds)', () => {
      it('dispatches emails and returns 200 when Gate 1 and Gate 2 match the batch exactly', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        const v2 = validVenue({ _id: v2Id, name: 'Venue Beta' });

        (venueModel as any).findById = vi.fn((id: string) => {
          if (id === v1Id) return Promise.resolve(v1);
          if (id === v2Id) return Promise.resolve(v2);
          return Promise.resolve(null);
        });

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Alpha',
          body: '<p>Hi Pat, booking for Oct 16-18.</p>',
        });
        const fp2 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Beta',
          body: '<p>Hi Pat, booking for Oct 16-18.</p>',
        });

        const gate1Doc = { batchId: 'batch-1', weekend: WEEKEND_STR, venueIds: [v1Id, v2Id], approver: 'Josh' };
        const gate2Doc = {
          batchId: 'batch-1',
          weekend: WEEKEND_STR,
          draftFingerprints: [
            { venueId: v1Id, fingerprint: fp1 },
            { venueId: v2Id, fingerprint: fp2 },
          ],
          approver: 'Josh',
        };

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate1Doc));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(gate2Doc));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'batch-1',
            venueIds: [v1Id, v2Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(200);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(payload.sent).toBe(2);
        expect(payload.requested).toBe(2);
        expect(payload.records).toHaveLength(2);
      });

      it('dispatches when batchId is derived from targetWeekend without explicit batchId', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Single Venue' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Single Venue',
          body: '<p>Hi Pat, booking for Oct 16-18.</p>',
        });

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: WEEKEND_STR, weekend: WEEKEND_STR, venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: WEEKEND_STR, weekend: WEEKEND_STR, draftFingerprints: [{ venueId: v1Id, fingerprint: fp1 }],
        }));

        const req: any = {
          user: oid(),
          body: {
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);
        expect(status).toBe(200);
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(payload.sent).toBe(1);
      });

      it('reuses verified rendered copy in performSend without duplicate resolvePitch calls (single-pass render)', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        const fp1 = computeDraftFingerprint({
          subject: 'Inquiry: Venue Alpha',
          body: '<p>Hi Pat, booking for Oct 16-18.</p>',
        });

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-single-pass',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-single-pass',
          draftFingerprints: [{ venueId: v1Id, fingerprint: fp1 }],
        }));

        const resolvePitchSpy = vi.spyOn(c, 'resolvePitch');
        const performSendSpy = vi.spyOn(c, 'performSend');

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-single-pass',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(200);
        expect(sendMail).toHaveBeenCalledTimes(1);
        // resolvePitch should be called only once during verification, NOT again in send loop
        expect(resolvePitchSpy).toHaveBeenCalledTimes(1);
        // performSend was called with preRendered argument
        expect(performSendSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.objectContaining({
            subject: 'Inquiry: Venue Alpha',
            html: '<p>Hi Pat, booking for Oct 16-18.</p>',
          }),
        );
      });
    });

    describe('Outcome 2: Either approval absent or non-matching (refused in full, no partial send)', () => {
      it('refuses dispatch (403) when Gate 1 venue-set approval is missing', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-missing-gate1',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp-any' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-missing-gate1',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 1 venue-set approval is missing');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch (403) when Gate 2 draft fingerprint approval is missing', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-missing-gate2',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-missing-gate2',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint approval is missing');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch in full (403) when batch has extra venue not approved in Gate 1', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid(); // not in Gate 1
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate1-mismatch',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate1-mismatch',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp1' }, { venueId: v2Id, fingerprint: 'fp2' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-gate1-mismatch',
            venueIds: [v1Id, v2Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 1 venue-set approval does not match batch venueIds');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch in full (403) on a silently shrunk batch (missing venue from Gate 1)', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate1-shrunk',
          venueIds: [v1Id, v2Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate1-shrunk',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp1' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-gate1-shrunk',
            venueIds: [v1Id], // silently dropped v2
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 1 venue-set approval does not match batch venueIds');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch in full (403) when Gate 2 fingerprints venue set does not match batch venues', async () => {
        asApprover();
        const v1Id = oid();
        const v2Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate2-venue-mismatch',
          venueIds: [v1Id, v2Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-gate2-venue-mismatch',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp1' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-gate2-venue-mismatch',
            venueIds: [v1Id, v2Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprints venue set does not match batch venues');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch in full (403) when rendered copy fingerprint diverges from Gate 2 approval', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-copy-mismatch',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-copy-mismatch',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'stale-or-tampered-fingerprint' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-copy-mismatch',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint mismatch for venue');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch (403) when Gate 2 fingerprint matches body only but diverges on { subject, body }', async () => {
        asApprover();
        const v1Id = oid();
        const v1 = validVenue({ _id: v1Id, name: 'Venue Alpha' });
        (venueModel as any).findById = vi.fn(() => Promise.resolve(v1));

        // Stored Gate 2 fingerprint was created with body-only string hash:
        const renderedHtml = '<p>Hi Pat, we are booking our October run and want Oct 16-18 at Venue Alpha.</p>';
        const bodyOnlyFingerprint = computeDraftFingerprint(renderedHtml);

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-body-only-hash',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-body-only-hash',
          draftFingerprints: [{ venueId: v1Id, fingerprint: bodyOnlyFingerprint }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-body-only-hash',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
            bookingPeriod: 'October',
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('Gate 2 draft fingerprint mismatch for venue');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch (403) when draft email cannot be rendered due to unresolvable venue/template', async () => {
        asApprover();
        const v1Id = oid();
        (venueModel as any).findById = vi.fn(() => Promise.resolve(null)); // venue not found

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-unresolvable',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-unresolvable',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'some-fp' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-unresolvable',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(403);
        expect(payload.message).toContain('cannot render draft for venue');
        expect(sendMail).not.toHaveBeenCalled();
      });
    });

    describe('Outcome 3: Indeterminate check (fails closed, refuses)', () => {
      it('refuses dispatch (500) when Gate 1 / Gate 2 approval records cannot be read from DB', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.reject(new Error('Mongo connection drop')));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-db-error',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(500);
        expect(payload.message).toContain('failed to read approval records');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch (500) when template resolution throws a database error', async () => {
        asApprover();
        const v1Id = oid();
        (venueModel as any).findById = vi.fn(() => Promise.reject(new Error('DB read failure for venue')));

        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-render-err',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-render-err',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp' }],
        }));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-render-err',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(500);
        expect(payload.message).toContain('re-rendering draft failed for venue');
        expect(sendMail).not.toHaveBeenCalled();
      });

      it('refuses dispatch (500) when an unexpected comparison error throws during check', async () => {
        asApprover();
        const v1Id = oid();
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-comp-err',
          venueIds: [v1Id],
        }));
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve({
          batchId: 'b-comp-err',
          draftFingerprints: [{ venueId: v1Id, fingerprint: 'fp' }],
        }));

        vi.spyOn(c, 'verifyVenueRenderedCopy').mockRejectedValueOnce(new Error('Crypto failure'));

        const req: any = {
          user: oid(),
          body: {
            batchId: 'b-comp-err',
            venueIds: [v1Id],
            targetDates: 'Oct 16-18',
            targetWeekend: VALID_WEEKEND,
          },
        };

        await c.sendBatch(req, resStub);

        expect(status).toBe(500);
        expect(payload.message).toContain('error during draft fingerprint verification');
        expect(sendMail).not.toHaveBeenCalled();
      });
    });

    describe('Deterministic Approval Lookups on Multi-Batch Weekends (web-jam-back#1082)', () => {
      it('prefers exact batchId match first on multi-batch weekends for Gate 1', async () => {
        const b2Doc = { batchId: 'batch-2', weekend: WEEKEND_STR, venueIds: [oid()] };
        (venueApprovalModel as any).findOne = vi.fn((q: any) => {
          if (q.batchId === 'batch-2') return Promise.resolve(b2Doc);
          return Promise.resolve(null);
        });

        const res = await c.getVenueSetApproval('batch-2', WEEKEND_STR);
        expect(res).toBe(b2Doc);
        expect(venueApprovalModel.findOne).toHaveBeenCalledWith({ batchId: 'batch-2' });
      });

      it('prefers exact batchId match first on multi-batch weekends for Gate 2', async () => {
        const b2Doc = { batchId: 'batch-2', weekend: WEEKEND_STR, draftFingerprints: [] };
        (draftApprovalModel as any).findOne = vi.fn((q: any) => {
          if (q.batchId === 'batch-2') return Promise.resolve(b2Doc);
          return Promise.resolve(null);
        });

        const res = await c.getDraftFingerprintsApproval('batch-2', WEEKEND_STR);
        expect(res).toBe(b2Doc);
        expect(draftApprovalModel.findOne).toHaveBeenCalledWith({ batchId: 'batch-2' });
      });

      it('falls back to weekend clauses with deterministic sorting when batchId does not match directly', async () => {
        const latestDoc = { batchId: 'batch-latest', weekend: WEEKEND_STR, venueIds: [oid()] };
        (venueApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
        (venueApprovalModel as any).findLatestOne = vi.fn(() => Promise.resolve(latestDoc));

        const res = await c.getVenueSetApproval('derived-batch-id', WEEKEND_STR);
        expect(res).toBe(latestDoc);
        expect(venueApprovalModel.findLatestOne).toHaveBeenCalledWith(
          { $or: [{ weekend: 'derived-batch-id' }, { weekend: WEEKEND_STR }, { batchId: WEEKEND_STR }] },
          { createdAt: -1, _id: -1 },
        );
      });

      it('falls back to weekend clauses with deterministic sorting for Gate 2', async () => {
        const latestDoc = { batchId: 'batch-latest', weekend: WEEKEND_STR, draftFingerprints: [] };
        (draftApprovalModel as any).findOne = vi.fn(() => Promise.resolve(null));
        (draftApprovalModel as any).findLatestOne = vi.fn(() => Promise.resolve(latestDoc));

        const res = await c.getDraftFingerprintsApproval('derived-batch-id', WEEKEND_STR);
        expect(res).toBe(latestDoc);
        expect(draftApprovalModel.findLatestOne).toHaveBeenCalledWith(
          { $or: [{ weekend: 'derived-batch-id' }, { weekend: WEEKEND_STR }, { batchId: WEEKEND_STR }] },
          { createdAt: -1, _id: -1 },
        );
      });
    });
  });
});


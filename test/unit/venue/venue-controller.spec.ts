/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import controller from '#src/model/venue/venue-controller.js';
import userModel from '#src/model/user/user-facade.js';
import gigModel from '#src/model/gig/gig-facade.js';

const c = controller as any;

describe('Venue Controller', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return { json: (obj: any) => { payload = obj; return obj; } };
    },
  };

  // Default: an AI-agent identity holding every venue capability.
  const asAgent = (privileges = ['venue:create', 'venue:edit', 'venue:delete']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  beforeEach(() => {
    status = 0;
    payload = undefined;
    asAgent();
  });

  describe('authorize', () => {
    it('403s when the capability is missing', async () => {
      asAgent(['venue:edit']);
      await c.createVenue({ user: 'a', body: { name: 'X' } }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toContain('venue:create');
    });

    it('401s when the user is not found', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      await c.listVenues({ user: 'a', query: {} }, resStub);
      expect(status).toBe(401);
    });

    it('allows a privilege-less admin via role fallback', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin', privileges: [] }));
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.listVenues({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
    });
  });

  describe('createVenue', () => {
    it('rejects a missing name', async () => {
      await c.createVenue({ user: 'a', body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Name');
    });

    it('rejects an invalid venueType', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', venueType: 'Bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('venueType');
    });

    it('rejects an invalid email', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', email: 'nope' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('valid email');
    });

    it('creates a new venue when there is no duplicate', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'new' }));
      c.model.create = create;
      await c.createVenue({ user: 'agent', body: { name: 'The Spot', city: 'Salem', actor: 'sonnet' } }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.status).toBe('active');
      expect(arg.lastModifiedBy).toBe('sonnet');
    });

    it('upserts onto an existing duplicate instead of inserting', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'dup1' }));
      const upd = vi.fn(() => Promise.resolve({ _id: 'dup1' }));
      c.model.findByIdAndUpdate = upd;
      const create = vi.fn();
      c.model.create = create;
      await c.createVenue({ user: 'agent', body: { name: 'The Spot', email: 'b@k.com' } }, resStub);
      expect(status).toBe(200);
      expect(create).not.toHaveBeenCalled();
      expect(upd).toHaveBeenCalledWith('dup1', expect.objectContaining({ status: 'active' }));
    });

    it('dedupes by email when an email is provided', async () => {
      const findOne = vi.fn(() => Promise.resolve(null));
      c.model.findOne = findOne;
      c.model.create = vi.fn(() => Promise.resolve({ _id: 'n' }));
      await c.createVenue({ user: 'a', body: { name: 'X', email: 'A@B.com' } }, resStub);
      expect(findOne).toHaveBeenCalledWith({ email: 'a@b.com' });
    });
  });

  describe('updateVenue', () => {
    it('rejects an invalid id', async () => {
      await c.updateVenue({ user: 'a', params: { id: 'nope' }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('Update id');
    });

    it('rejects an invalid status', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.updateVenue({ user: 'a', params: { id }, body: { status: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('status');
    });

    it('updates a valid record', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({ user: 'agent', params: { id }, body: { notes: 'called them' } }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ notes: 'called them', lastModifiedBy: 'agent' }));
    });
  });

  describe('deleteVenue (soft-delete)', () => {
    it('archives rather than hard-deleting', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id, status: 'archived' }));
      c.model.findByIdAndUpdate = upd;
      await c.deleteVenue({ user: 'a', params: { id }, body: {} }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'archived' }));
      expect(payload.message).toContain('archived');
    });

    it('rejects an invalid id', async () => {
      await c.deleteVenue({ user: 'a', params: { id: 'bad' }, body: {} }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('getVenue', () => {
    it('rejects an invalid id', async () => {
      await c.getVenue({ user: 'a', params: { id: 'bad' } }, resStub);
      expect(status).toBe(400);
    });

    it('returns a found venue', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, name: 'The Spot' }));
      await c.getVenue({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(payload.name).toBe('The Spot');
    });
  });

  describe('listVenues', () => {
    it('returns the collection', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ name: 'A' }, { name: 'B' }]));
      await c.listVenues({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(payload).toHaveLength(2);
    });

    it('applies the ±2-month eligibility filter against gigs', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ name: 'Open Cafe' }, { name: 'Booked Bar' }]));
      (gigModel as any).find = vi.fn(() => Promise.resolve([
        { venue: '<a href="x">Booked Bar</a>', datetime: '2026-07-15T00:00:00.000Z' },
      ]));
      await c.listVenues({ user: 'a', query: { eligibleFor: '2026-07-01' } }, resStub);
      expect(status).toBe(200);
      expect(payload.map((v: any) => v.name)).toEqual(['Open Cafe']);
    });

    it('rejects an invalid eligibleFor date', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      await c.listVenues({ user: 'a', query: { eligibleFor: 'not-a-date' } }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('buildListFilter', () => {
    it('hides archived by default', () => {
      expect((controller as any).constructor.buildListFilter({})).toEqual({ status: { $ne: 'archived' } });
    });

    it('honors an explicit status and venueType', () => {
      const f = (controller as any).constructor.buildListFilter({ status: 'archived', venueType: 'Originals' });
      expect(f).toEqual({ status: 'archived', venueType: 'Originals' });
    });

    it('filters by outreachEligible (#843) — only vetted venues', () => {
      const f = (controller as any).constructor.buildListFilter({ outreachEligible: 'true' });
      expect(f).toMatchObject({ outreachEligible: true });
      const g = (controller as any).constructor.buildListFilter({ outreachEligible: 'false' });
      expect(g).toMatchObject({ outreachEligible: false });
    });

    it('filters by the vetting tags inScope / bookingStatus / interested (#843)', () => {
      const f = (controller as any).constructor.buildListFilter({ inScope: 'true', bookingStatus: 'booking', interested: 'true' });
      expect(f).toMatchObject({ inScope: true, bookingStatus: 'booking', interested: true });
      const g = (controller as any).constructor.buildListFilter({ inScope: 'false', interested: 'false' });
      expect(g).toMatchObject({ inScope: false, interested: false });
    });
  });

  describe('vetting tags (#843)', () => {
    it('rejects an invalid bookingStatus', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', bookingStatus: 'bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('bookingStatus');
    });

    it('persists the vetting tags on create', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'v10' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a',
        body: {
          name: 'Olde Salem', inScope: true, bookingStatus: 'booked', interested: false, payTier: 'low', contactVerified: true,
        },
      }, resStub);
      expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
        inScope: true, bookingStatus: 'booked', interested: false, payTier: 'low', contactVerified: true,
      });
    });

    it('lets the tags be set via update', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({ user: 'a', params: { id }, body: { inScope: false, interested: false } }, resStub);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ inScope: false, interested: false }));
    });
  });

  describe('outreachEligible tagging (#843)', () => {
    it('persists outreachEligible on create (passes through ...body)', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'v9' }));
      c.model.create = create;
      await c.createVenue({ user: 'a', body: { name: 'The Spot', venueType: 'Originals', outreachEligible: true } }, resStub);
      expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ outreachEligible: true, venueType: 'Originals' });
    });

    it('lets a venue be tagged eligible via update', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({ user: 'a', params: { id }, body: { outreachEligible: true } }, resStub);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ outreachEligible: true }));
    });
  });
});

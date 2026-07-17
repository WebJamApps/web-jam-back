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
    // #958 — listVenues/getVenue now always call gigModel.find once (for
    // attachGigLinks); default it to empty so tests that don't care about gig
    // linkage never hit the real DB. Tests exercising the linkage override this.
    (gigModel as any).find = vi.fn(() => Promise.resolve([]));
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

    it('rejects an invalid relationshipStage (#848)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', relationshipStage: 'lukewarm' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('relationshipStage');
    });

    it('rejects an invalid templateOverride (#848)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', templateOverride: 'Bogus' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('templateOverride');
    });

    it('rejects an invalid originalsFit (#867)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', originalsFit: 'meh' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('originalsFit');
    });

    it('rejects an invalid travelBand (#867)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', travelBand: 'moon' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('travelBand');
    });

    it('rejects an out-of-range priority (#867)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', priority: 9 } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('priority');
    });

    it('rejects a non-numeric priority (#867)', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', priority: 'high' as unknown as number } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('priority');
    });

    it('accepts + passes through the ranking fields (#867)', async () => {
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'n' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a',
        body: {
          name: 'The Spot', originalsFit: 'loves', travelBand: 'local', priority: 4,
        },
      }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.originalsFit).toBe('loves');
      expect(arg.travelBand).toBe('local');
      expect(arg.priority).toBe(4);
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

    // #923 — global outcome standing: doNotContact (permanent exclusion) + the
    // actual booked gig date, both written by the future outcome-recording
    // endpoint (#898) but pass through updateVenue like any other field today.
    it('accepts doNotContact + bookedDate (#923)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({
        user: 'agent', params: { id }, body: { doNotContact: true, bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ doNotContact: true, bookedDate: '2026-09-26' }));
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

    // #958 — GET /venue/:id gets the same computed lastGig/nextGig/
    // locationFallback as the list route (see attachGigLinks tests below).
    it('attaches lastGig/nextGig/locationFallback (#958)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, name: 'The Spot' }));
      (gigModel as any).find = vi.fn(() => Promise.resolve([
        {
          venueId: id, datetime: new Date(Date.now() + 86400000).toISOString(), city: 'Roanoke', usState: 'Virginia',
        },
      ]));
      await c.getVenue({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(200);
      expect(payload.nextGig).toBeTruthy();
      expect(payload.lastGig).toBeNull();
      expect(payload.locationFallback).toEqual({ city: 'Roanoke', usState: 'Virginia' });
    });

    it('500s when the gig-link query throws', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, name: 'The Spot' }));
      (gigModel as any).find = vi.fn(() => Promise.reject(new Error('db down')));
      await c.getVenue({ user: 'a', params: { id } }, resStub);
      expect(status).toBe(500);
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

    // web-jam-back#922: gigs is a shared collection — Tim's calendar must never
    // gate Josh's outreach eligibility.
    it('does not drop a venue for a Tim-only gig, but still drops for josh/artist-less gigs', async () => {
      c.model.find = vi.fn(() => Promise.resolve([
        { name: 'Venue X' }, { name: 'Venue Y' }, { name: 'Venue Z' },
      ]));
      (gigModel as any).find = vi.fn((filter: any) => {
        // Simulate the real Mongo $or predicate against a mixed-artist collection.
        const all = [
          { venue: 'Venue X', datetime: '2026-07-15T00:00:00.000Z', artist: 'tim' },
          { venue: 'Venue Y', datetime: '2026-07-15T00:00:00.000Z', artist: 'josh' },
          { venue: 'Venue Z', datetime: '2026-07-15T00:00:00.000Z' }, // pre-migration, no artist field
        ];
        const matches = all.filter((g) => filter.$or.some((clause: any) => (
          clause.artist === g.artist
          || (clause.artist && clause.artist.$exists === false && g.artist === undefined)
        )));
        return Promise.resolve(matches);
      });
      await c.listVenues({ user: 'a', query: { eligibleFor: '2026-07-01' } }, resStub);
      expect(status).toBe(200);
      expect(payload.map((v: any) => v.name)).toEqual(['Venue X']);
    });

    // #958 — computed lastGig/nextGig/locationFallback, resolved via
    // venueId-first / exact-normalized-name fallback (src/lib/gig-venue-link.ts).
    describe('attachGigLinks (#958)', () => {
      it('resolves lastGig (past) and nextGig (future) via venueId', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'The Spot' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: idA, datetime: '2026-01-01T00:00:00.000Z' }, // past
          { venueId: idA, datetime: '2099-01-01T00:00:00.000Z' }, // future
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload[0].lastGig.datetime).toBe('2026-01-01T00:00:00.000Z');
        expect(payload[0].nextGig.datetime).toBe('2099-01-01T00:00:00.000Z');
      });

      it('resolves via exact normalized-name match when venueId is absent', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'Durty Bull' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venue: 'DURTY, BULL!', datetime: '2099-01-01T00:00:00.000Z' },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload[0].nextGig).toBeTruthy();
      });

      it('never fuzzy-matches: an ambiguous name (2+ venues) resolves nothing', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: new mongoose.Types.ObjectId().toString(), name: 'The Spot' },
          { _id: new mongoose.Types.ObjectId().toString(), name: 'the spot' },
        ]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venue: 'The Spot', datetime: '2099-01-01T00:00:00.000Z' },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload.every((v: any) => v.nextGig === null)).toBe(true);
      });

      it('prefers lastGig for locationFallback, falling back to nextGig when there is no past gig (Durty Bull case)', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'Durty Bull', city: '', usState: '' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          {
            venueId: idA, datetime: '2099-11-16T00:00:00.000Z', city: 'Roanoke', usState: 'Virginia',
          },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload[0].lastGig).toBeNull();
        expect(payload[0].locationFallback).toEqual({ city: 'Roanoke', usState: 'Virginia' });
      });

      it('locationFallback is null when there is no linked gig', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: new mongoose.Types.ObjectId().toString(), name: 'No Gigs Here' }]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(200);
        expect(payload[0].locationFallback).toBeNull();
        expect(payload[0].lastGig).toBeNull();
        expect(payload[0].nextGig).toBeNull();
      });

      it('500s when the gig-link query throws', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: new mongoose.Types.ObjectId().toString(), name: 'X' }]));
        (gigModel as any).find = vi.fn(() => Promise.reject(new Error('db down')));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(status).toBe(500);
      });
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

    it('filters by the vetting tags bookingStatus / interested (#843)', () => {
      const f = (controller as any).constructor.buildListFilter({ bookingStatus: 'booking', interested: 'true' });
      expect(f).toMatchObject({ bookingStatus: 'booking', interested: true });
      const g = (controller as any).constructor.buildListFilter({ interested: 'false' });
      expect(g).toMatchObject({ interested: false });
    });

    // #954 — inScope was dropped entirely; ?inScope=... must no longer surface
    // in the built filter (it's just an unrecognized query param now).
    it('no longer supports an inScope filter (#954)', () => {
      const f = (controller as any).constructor.buildListFilter({ inScope: 'true' });
      expect(f).not.toHaveProperty('inScope');
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
          name: 'Olde Salem', bookingStatus: 'booked', interested: false, payTier: 'low', contactVerified: true,
        },
      }, resStub);
      expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
        bookingStatus: 'booked', interested: false, payTier: 'low', contactVerified: true,
      });
    });

    it('lets the tags be set via update', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({ user: 'a', params: { id }, body: { interested: false } }, resStub);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ interested: false }));
    });
  });

  describe('addTouch — POST /venue/:id/touch (#898)', () => {
    it('403s without venue:edit', async () => {
      asAgent(['venue:create']);
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'call' } }, resStub);
      expect(status).toBe(403);
    });

    it('rejects an invalid venue id', async () => {
      await c.addTouch({ user: 'a', params: { id: 'nope' }, body: { type: 'call' } }, resStub);
      expect(status).toBe(400);
    });

    it('rejects a missing/invalid type', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('type must be one of');
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'smoke-signal' } }, resStub);
      expect(status).toBe(400);
    });

    it('rejects an invalid targetWeekend', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({
        user: 'a', params: { id }, body: { type: 'email', targetWeekend: { start: '2026-09-25' } },
      }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('targetWeekend');
    });

    it('rejects an outcome touch missing/invalid outcome', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'outcome' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('outcome must be one of');
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'outcome', outcome: 'meh' } }, resStub);
      expect(status).toBe(400);
    });

    it('rejects a booked outcome touch with no/invalid bookedDate', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'outcome', outcome: 'booked' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('bookedDate');
      await c.addTouch({
        user: 'a', params: { id }, body: { type: 'outcome', outcome: 'booked', bookedDate: 'nope' },
      }, resStub);
      expect(status).toBe(400);
    });

    it('rejects outcome set on a non-outcome touch', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'call', outcome: 'booked' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('only valid on an outcome touch');
    });

    it('rejects an invalid outreachId', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'email', outreachId: 'bad' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('outreachId');
    });

    it('rejects an invalid explicit date', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'call', date: 'whenever' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('date');
    });

    it('appends a manual touch (visit/call/card/etc.)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id, touches: [{ type: 'call' }] }));
      c.model.findByIdAndUpdate = upd;
      await c.addTouch({
        user: 'agent', params: { id }, body: { type: 'call', note: 'left voicemail', actor: 'josh' },
      }, resStub);
      expect(status).toBe(201);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({
        $push: { touches: expect.objectContaining({ type: 'call', note: 'left voicemail', actor: 'josh' }) },
        lastModifiedBy: 'josh',
      }));
    });

    it('appends an email-sent touch with templateType + targetWeekend', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.addTouch({
        user: 'agent',
        params: { id },
        body: {
          type: 'email', templateType: 'Originals', targetWeekend: { start: '2026-09-25', end: '2026-09-27' },
        },
      }, resStub);
      expect(status).toBe(201);
      const touch = (upd.mock.calls[0] as any)[1].$push.touches;
      expect(touch).toMatchObject({
        type: 'email', templateType: 'Originals', targetWeekend: { start: new Date('2026-09-25'), end: new Date('2026-09-27') },
      });
    });

    it('appends an outcome touch (booked) with bookedDate', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.addTouch({
        user: 'agent', params: { id }, body: { type: 'outcome', outcome: 'booked', bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(201);
      const touch = (upd.mock.calls[0] as any)[1].$push.touches;
      expect(touch).toMatchObject({ type: 'outcome', outcome: 'booked', bookedDate: new Date('2026-09-26') });
    });

    it('400s when the id is not found', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve(null));
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'visit' } }, resStub);
      expect(status).toBe(400);
    });

    it('500s when the write throws', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('db down')));
      await c.addTouch({ user: 'a', params: { id }, body: { type: 'visit' } }, resStub);
      expect(status).toBe(500);
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

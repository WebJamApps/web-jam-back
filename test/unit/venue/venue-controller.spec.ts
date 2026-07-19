/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import controller from '#src/model/venue/venue-controller.js';
import userModel from '#src/model/user/user-facade.js';
import gigModel from '#src/model/gig/gig-facade.js';
import venueModel from '#src/model/venue/venue-facade.js';

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
    // #983 — createVenue's non-blocking email-elsewhere notice calls
    // model.findOne whenever the body has an email; default it to null so a
    // test that doesn't care about the notice never hits the real DB.
    (venueModel as any).findOne = vi.fn(() => Promise.resolve(null));
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
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'n' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a',
        body: {
          name: 'The Spot', address: '1 Main St', originalsFit: 'loves', travelBand: 'local', priority: 4,
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

    // #974 — secondaryEmail: optional second booking contact, validated the
    // same way as the primary when present.
    it('rejects an invalid secondaryEmail', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', email: 'a@b.com', secondaryEmail: 'nope' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('valid secondary email');
    });

    it('accepts + passes through a valid secondaryEmail alongside the primary (#974)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      c.model.findOne = vi.fn(() => Promise.resolve(null));
      const create = vi.fn(() => Promise.resolve({ _id: 'n3' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a',
        body: {
          name: 'Slow Play Brewing', address: '1 Main St', email: 'info@slowplaybrewing.com', secondaryEmail: 'chelsea@slowplaybrewing.com',
        },
      }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.email).toBe('info@slowplaybrewing.com');
      expect(arg.secondaryEmail).toBe('chelsea@slowplaybrewing.com');
    });

    it('allows an empty-string secondaryEmail (unset, not an error)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'n4' }));
      c.model.create = create;
      await c.createVenue({ user: 'a', body: { name: 'X', address: '1 Main St', secondaryEmail: '' } }, resStub);
      expect(status).toBe(201);
    });

    // #972 — country (2-letter code, default 'US' at the schema level) + region
    // (free-text, non-US state/province).
    it('rejects an invalid country', async () => {
      await c.createVenue({ user: 'a', body: { name: 'X', country: 'USA' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('country');
      await c.createVenue({ user: 'a', body: { name: 'X', country: '1' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('country');
    });

    it('accepts + passes through country + region (#972)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'n2' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a', body: { name: 'The North Spot', address: '1 Main St', country: 'ca', region: 'Ontario' },
      }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.country).toBe('ca');
      expect(arg.region).toBe('Ontario');
    });

    it('creates a new venue when there is no duplicate', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'new' }));
      c.model.create = create;
      await c.createVenue({
        user: 'agent', body: {
          name: 'The Spot', city: 'Salem', address: '1 Main St', actor: 'sonnet',
        },
      }, resStub);
      expect(status).toBe(201);
      const arg = (create.mock.calls[0] as unknown[])[0] as any;
      expect(arg.status).toBe('active');
      expect(arg.lastModifiedBy).toBe('sonnet');
    });

    it('upserts onto an existing duplicate instead of inserting', async () => {
      c.model.find = vi.fn(() => Promise.resolve([{ _id: 'dup1', name: 'The Spot' }]));
      const upd = vi.fn(() => Promise.resolve({ _id: 'dup1' }));
      c.model.findByIdAndUpdate = upd;
      const create = vi.fn();
      c.model.create = create;
      await c.createVenue({ user: 'agent', body: { name: 'The Spot', address: '1 Main St', email: 'b@k.com' } }, resStub);
      expect(status).toBe(200);
      expect(create).not.toHaveBeenCalled();
      expect(upd).toHaveBeenCalledWith('dup1', expect.objectContaining({ status: 'active' }));
    });

    // #983 — dedup logic. Email is entirely out of the match key now; only
    // name+city (refined by address when both sides have one) is used.
    describe('dedup (#983)', () => {
      it('matches by name+city (case-insensitive); the one legacy address-less candidate is upserted onto (#987)', async () => {
        const find = vi.fn(() => Promise.resolve([{ _id: 'dup2', name: 'The Spot', city: 'Salem' }]));
        c.model.find = find;
        const upd = vi.fn(() => Promise.resolve({ _id: 'dup2' }));
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: 'the spot', city: 'SALEM', address: '1 Main St' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith('dup2', expect.objectContaining({ status: 'active' }));
      });

      // #987 — address is required on every POST now, so "no address on
      // either side" is no longer a create scenario; the incoming address
      // fills in on the one legacy address-less candidate instead.
      it('same name+city, exactly one legacy address-less candidate ⇒ upserts onto it, filling the address in', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'dup3', name: "Macado's", city: 'Roanoke' }]));
        const upd = vi.fn(() => Promise.resolve({ _id: 'dup3' }));
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: "Macado's", city: 'Roanoke', address: '1 Electric Road' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith('dup3', expect.objectContaining({ status: 'active', address: '1 Electric Rd' }));
      });

      it('same name+city, different (both non-empty) address ⇒ creates a new record, not an overwrite', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          {
            _id: 'macados-1', name: "Macado's", city: 'Roanoke', address: '1 Electric Rd',
          },
        ]));
        const create = vi.fn(() => Promise.resolve({ _id: 'macados-2' }));
        c.model.create = create;
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: "Macado's", city: 'Roanoke', address: '2 Franklin Rd' },
        }, resStub);
        expect(status).toBe(201);
        expect(upd).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalled();
      });

      it('same name+city+same address (case-insensitive) ⇒ matches the right location', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          {
            _id: 'macados-1', name: "Macado's", city: 'Roanoke', address: '1 Electric Rd',
          },
          {
            _id: 'macados-2', name: "Macado's", city: 'Roanoke', address: '2 Franklin Rd',
          },
        ]));
        const upd = vi.fn(() => Promise.resolve({ _id: 'macados-2' }));
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: "Macado's", city: 'Roanoke', address: '2 franklin rd' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith('macados-2', expect.objectContaining({ status: 'active' }));
      });

      it('incoming has an address, existing candidate has none ⇒ still matches (falls back to name+city, fills the address in)', async () => {
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'dup4', name: 'Starr Hill Pilot Brewery', city: 'Roanoke' }]));
        const upd = vi.fn(() => Promise.resolve({ _id: 'dup4' }));
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: 'Starr Hill Pilot Brewery', city: 'Roanoke', address: '5 Points' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith('dup4', expect.objectContaining({ address: '5 Points' }));
      });

      it('shared email across two differently-named venues ⇒ two records, no overwrite (the Starr Hill fix)', async () => {
        // findDuplicate matches on name+city only — a different name never
        // returns a match, regardless of a shared email, so no findOne-by-
        // email path exists anymore to accidentally overwrite the other venue.
        c.model.find = vi.fn(() => Promise.resolve([]));
        c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'starr-hill-on-main', name: 'Starr Hill On Main' }));
        const create = vi.fn(() => Promise.resolve({ _id: 'starr-hill-pilot-brewery', name: 'Starr Hill Pilot Brewery' }));
        c.model.create = create;
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: 'Starr Hill Pilot Brewery', city: 'Roanoke', address: '5 Points', email: 'info@starrhill.com' },
        }, resStub);
        expect(status).toBe(201);
        expect(upd).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalled();
      });

      it('logs a non-blocking notice when the email is found elsewhere, without blocking or overwriting', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'other-venue', name: 'Starr Hill On Main' }));
        const create = vi.fn(() => Promise.resolve({ _id: 'new-venue' }));
        c.model.create = create;
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        await c.createVenue({
          user: 'a', body: { name: 'Starr Hill Pilot Brewery', city: 'Roanoke', address: '5 Points', email: 'info@starrhill.com' },
        }, resStub);
        expect(status).toBe(201);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("also used by venue 'Starr Hill On Main'"));
        logSpy.mockRestore();
      });

      it('the email-notice lookup failing never blocks the create', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        c.model.findOne = vi.fn(() => Promise.reject(new Error('db down')));
        const create = vi.fn(() => Promise.resolve({ _id: 'new-venue' }));
        c.model.create = create;
        await c.createVenue({
          user: 'a', body: { name: 'Some Venue', address: '1 Main St', email: 'info@starrhill.com' },
        }, resStub);
        expect(status).toBe(201);
      });

      // #985 — persist the duplicate-email notice to the NEW venue's own
      // notes field (append, never overwrite), since a server-log-only notice
      // was never visible to a human in AdminVenues.
      describe('duplicate-email note append (#985)', () => {
        it('appends a dated note to the new venue when its email is found on another venue', async () => {
          c.model.find = vi.fn(() => Promise.resolve([]));
          c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'other-venue', name: 'Starr Hill Pilot Brewery' }));
          const create = vi.fn(() => Promise.resolve({ _id: 'new-venue' }));
          c.model.create = create;
          await c.createVenue({
            user: 'a', body: { name: 'Starr Hill On Main', city: 'Lynchburg', address: '5 Points', email: 'info@starrhill.com' },
          }, resStub);
          expect(status).toBe(201);
          const arg = (create.mock.calls[0] as unknown[])[0] as any;
          const today = new Date().toISOString().slice(0, 10);
          expect(arg.notes).toBe(`[${today}] Email info@starrhill.com also used by venue 'Starr Hill Pilot Brewery'.`);
        });

        it('preserves pre-existing notes on the new venue (appended, not overwritten)', async () => {
          c.model.find = vi.fn(() => Promise.resolve([]));
          c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'other-venue', name: 'Starr Hill Pilot Brewery' }));
          const create = vi.fn(() => Promise.resolve({ _id: 'new-venue' }));
          c.model.create = create;
          await c.createVenue({
            user: 'a',
            body: {
              name: 'Starr Hill On Main', city: 'Lynchburg', address: '5 Points', email: 'info@starrhill.com', notes: 'Great patio.',
            },
          }, resStub);
          expect(status).toBe(201);
          const arg = (create.mock.calls[0] as unknown[])[0] as any;
          expect(arg.notes).toMatch(/^Great patio\.\n\[\d{4}-\d{2}-\d{2}] Email info@starrhill\.com also used by venue 'Starr Hill Pilot Brewery'\.$/);
        });

        it('adds no note when the email is unique (not found elsewhere)', async () => {
          c.model.find = vi.fn(() => Promise.resolve([]));
          c.model.findOne = vi.fn(() => Promise.resolve(null));
          const create = vi.fn(() => Promise.resolve({ _id: 'new-venue' }));
          c.model.create = create;
          await c.createVenue({
            user: 'a', body: { name: 'Unique Venue', address: '1 Main St', email: 'nobody-else@x.com' },
          }, resStub);
          expect(status).toBe(201);
          const arg = (create.mock.calls[0] as unknown[])[0] as any;
          expect(arg).not.toHaveProperty('notes');
        });

        it('does not annotate notes on the upsert-onto-existing-match path (only a newly-created record is annotated)', async () => {
          c.model.find = vi.fn(() => Promise.resolve([{ _id: 'dup5', name: 'The Spot', city: 'Salem' }]));
          c.model.findOne = vi.fn(() => Promise.resolve({ _id: 'other-venue', name: 'Some Other Venue' }));
          const upd = vi.fn(() => Promise.resolve({ _id: 'dup5' }));
          c.model.findByIdAndUpdate = upd;
          const create = vi.fn();
          c.model.create = create;
          await c.createVenue({
            user: 'a', body: { name: 'The Spot', city: 'Salem', address: '1 Main St', email: 'shared@x.com' },
          }, resStub);
          expect(status).toBe(200);
          expect(create).not.toHaveBeenCalled();
          const written = (upd.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
          expect(written).not.toHaveProperty('notes');
        });
      });

      it('findDuplicate: no candidates at all resolves { kind: "none" }', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        const result = await c.findDuplicate({ name: 'Nobody Here' });
        expect(result).toEqual({ kind: 'none' });
      });

      it('findDuplicate: an address supplied with no matching candidate and no unambiguous address-less fallback resolves { kind: "none" }', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          {
            _id: 'a1', name: "Macado's", city: 'Roanoke', address: '1 Electric Rd',
          },
          {
            _id: 'a2', name: "Macado's", city: 'Roanoke', address: '2 Franklin Rd',
          },
        ]));
        const result = await c.findDuplicate({ name: "Macado's", city: 'Roanoke', address: '3 Brand New Rd' });
        expect(result).toEqual({ kind: 'none' });
      });

      // #987 Part B — two or more legacy (address-less) candidates for the
      // same name+city: do not guess, do not silently duplicate.
      it('findDuplicate: two+ legacy address-less candidates resolves { kind: "ambiguous" } naming their ids', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: 'legacy-1', name: 'Old Venue', city: 'Salem' },
          { _id: 'legacy-2', name: 'Old Venue', city: 'Salem' },
        ]));
        const result = await c.findDuplicate({ name: 'Old Venue', city: 'Salem', address: '1 Main St' });
        expect(result).toEqual({ kind: 'ambiguous', ids: ['legacy-1', 'legacy-2'] });
      });

      it('POST /venue 400s naming the ids when two+ legacy address-less candidates match name+city', async () => {
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: 'legacy-1', name: 'Old Venue', city: 'Salem' },
          { _id: 'legacy-2', name: 'Old Venue', city: 'Salem' },
        ]));
        const create = vi.fn();
        c.model.create = create;
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.createVenue({
          user: 'a', body: { name: 'Old Venue', city: 'Salem', address: '1 Main St' },
        }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('legacy-1');
        expect(payload.message).toContain('legacy-2');
        expect(create).not.toHaveBeenCalled();
        expect(upd).not.toHaveBeenCalled();
      });
    });

    // #987 Part A — normalization on write (POST).
    describe('address normalization on create (#987)', () => {
      it('normalizes the stored address per the USPS Pub 28 table', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        const create = vi.fn(() => Promise.resolve({ _id: 'norm-1' }));
        c.model.create = create;
        await c.createVenue({
          user: 'a', body: { name: 'Norm Venue', address: '100 North Main Street, Suite 2' },
        }, resStub);
        expect(status).toBe(201);
        const arg = (create.mock.calls[0] as unknown[])[0] as any;
        expect(arg.address).toBe('100 N Main St Ste 2');
      });

      it('"1 Electric Road" and "1 Electric Rd" resolve to the same venue (one record, normalized form stored)', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        const create = vi.fn(() => Promise.resolve({ _id: 'macados-1', address: '1 Electric Rd' }));
        c.model.create = create;
        await c.createVenue({
          user: 'a', body: { name: 'Macados', city: 'Roanoke', address: '1 Electric Road' },
        }, resStub);
        expect(status).toBe(201);
        const created = (create.mock.calls[0] as unknown[])[0] as any;
        expect(created.address).toBe('1 Electric Rd');

        // Re-post with the already-abbreviated form: matches the same venue
        // by normalized address, upserts rather than creating a second record.
        c.model.find = vi.fn(() => Promise.resolve([{ _id: 'macados-1', name: 'Macados', city: 'Roanoke', address: '1 Electric Rd' }]));
        const upd = vi.fn(() => Promise.resolve({ _id: 'macados-1' }));
        c.model.findByIdAndUpdate = upd;
        const create2 = vi.fn();
        c.model.create = create2;
        await c.createVenue({
          user: 'a', body: { name: 'Macados', city: 'Roanoke', address: '1 Electric Rd' },
        }, resStub);
        expect(status).toBe(200);
        expect(create2).not.toHaveBeenCalled();
        expect(upd).toHaveBeenCalledWith('macados-1', expect.objectContaining({ address: '1 Electric Rd' }));
      });
    });

    // #987 Part B — address required on every POST /venue.
    describe('address required on create (#987)', () => {
      it('rejects a missing address, before any DB write', async () => {
        const find = vi.fn();
        c.model.find = find;
        const create = vi.fn();
        c.model.create = create;
        await c.createVenue({ user: 'a', body: { name: 'X' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('address is required');
        expect(find).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it('rejects an empty-string address', async () => {
        await c.createVenue({ user: 'a', body: { name: 'X', address: '' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('address is required');
      });

      it('rejects a whitespace-only address', async () => {
        await c.createVenue({ user: 'a', body: { name: 'X', address: '   ' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('address is required');
      });
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

    // #972 — country/region accepted through the partial-merge PUT path too.
    it('rejects an invalid country on update', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.updateVenue({ user: 'a', params: { id }, body: { country: 'usa' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('country');
    });

    it('accepts country + region on update (#972)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({
        user: 'agent', params: { id }, body: { country: 'CA', region: 'Quebec' },
      }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ country: 'CA', region: 'Quebec' }));
    });

    // #923 — bookedDate (the actual booked gig date, written by the outcome-
    // recording endpoint #898) passes through updateVenue like any other field.
    it('accepts bookedDate (#923)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({
        user: 'agent', params: { id }, body: { bookedDate: '2026-09-26' },
      }, resStub);
      expect(status).toBe(200);
      expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ bookedDate: '2026-09-26' }));
    });

    // #980 — doNotContact was deleted entirely (folded into outreachEligible).
    // A stale client that still sends it must not error and must not have it
    // written — silently stripped, like _id.
    it('strips a stray doNotContact from the body instead of writing or erroring (#980)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({
        user: 'agent', params: { id }, body: { doNotContact: true, outreachEligible: false },
      }, resStub);
      expect(status).toBe(200);
      const written = (upd.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(written).not.toHaveProperty('doNotContact');
      expect(written).toMatchObject({ outreachEligible: false });
    });

    // #980 — bookingStatus is derived/read-only now: a stray value in the
    // body must be stripped (never written, never validated/rejected).
    it('strips a stray bookingStatus from the body instead of writing or erroring (#980)', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const upd = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = upd;
      await c.updateVenue({
        user: 'agent', params: { id }, body: { bookingStatus: 'booked', notes: 'x' },
      }, resStub);
      expect(status).toBe(200);
      const written = (upd.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(written).not.toHaveProperty('bookingStatus');
      expect(written).toMatchObject({ notes: 'x' });
    });

    // #987 — address normalization on PUT (Part A) + the once-set-cannot-be-
    // removed rule (Part B).
    describe('address handling on update (#987)', () => {
      it('omitting address entirely leaves it unchanged (no lookup, no address in the write)', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        const findById = vi.fn();
        c.model.findById = findById;
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { notes: 'x' } }, resStub);
        expect(status).toBe(200);
        expect(findById).not.toHaveBeenCalled();
        const written = (upd.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
        expect(written).not.toHaveProperty('address');
      });

      it('a non-empty address is normalized identically to POST (Part A)', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({
          user: 'agent', params: { id }, body: { address: '221 Church Street' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ address: '221 Church St' }));
      });

      it('explicit "" on a venue that HAS an address ⇒ 400, nothing written', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.resolve({ _id: id, address: '1 Electric Rd' }));
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { address: '' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('cannot be removed');
        expect(upd).not.toHaveBeenCalled();
      });

      it('explicit null on a venue that HAS an address ⇒ 400, nothing written', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.resolve({ _id: id, address: '1 Electric Rd' }));
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({
          user: 'agent', params: { id }, body: { address: null as unknown as string },
        }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('cannot be removed');
        expect(upd).not.toHaveBeenCalled();
      });

      it('whitespace-only address on a venue that HAS an address ⇒ 400, nothing written', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.resolve({ _id: id, address: '1 Electric Rd' }));
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { address: '   ' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('cannot be removed');
        expect(upd).not.toHaveBeenCalled();
      });

      it('the same "" call on an address-less venue ⇒ allowed no-op', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.resolve({ _id: id }));
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { address: '' } }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ address: '' }));
      });

      it('400s "Id Not Found" when clearing address on a venue that does not exist', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.resolve(null));
        const upd = vi.fn();
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { address: '' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('Id Not Found');
        expect(upd).not.toHaveBeenCalled();
      });

      it('500s when the pre-check lookup throws', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        c.model.findById = vi.fn(() => Promise.reject(new Error('db down')));
        await c.updateVenue({ user: 'agent', params: { id }, body: { address: '' } }, resStub);
        expect(status).toBe(500);
      });
    });

    // #980 — gigInterval (spacing, months) + resumeBooking (cooldown date).
    describe('gigInterval / resumeBooking (#980)', () => {
      it('accepts gigInterval + resumeBooking on update', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({
          user: 'agent', params: { id }, body: { gigInterval: 4, resumeBooking: '2026-11-01' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ gigInterval: 4, resumeBooking: '2026-11-01' }));
      });

      it('rejects a negative gigInterval', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        await c.updateVenue({ user: 'agent', params: { id }, body: { gigInterval: -1 } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('gigInterval');
      });

      it('rejects a non-integer gigInterval', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        await c.updateVenue({ user: 'agent', params: { id }, body: { gigInterval: 2.5 } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('gigInterval');
      });

      it('accepts gigInterval: 0 (spacing off, the default)', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({ user: 'agent', params: { id }, body: { gigInterval: 0 } }, resStub);
        expect(status).toBe(200);
      });

      it('rejects an invalid resumeBooking date', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        await c.updateVenue({ user: 'agent', params: { id }, body: { resumeBooking: 'not-a-date' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('resumeBooking');
      });
    });

    // #995 — bookedThrough: a separate optional Date, validated identically
    // to resumeBooking above.
    describe('bookedThrough (#995)', () => {
      it('accepts bookedThrough on update', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        const upd = vi.fn(() => Promise.resolve({ _id: id }));
        c.model.findByIdAndUpdate = upd;
        await c.updateVenue({
          user: 'agent', params: { id }, body: { bookedThrough: '2026-12-31' },
        }, resStub);
        expect(status).toBe(200);
        expect(upd).toHaveBeenCalledWith(id, expect.objectContaining({ bookedThrough: '2026-12-31' }));
      });

      it('rejects an invalid bookedThrough date', async () => {
        const id = new mongoose.Types.ObjectId().toString();
        await c.updateVenue({ user: 'agent', params: { id }, body: { bookedThrough: 'not-a-date' } }, resStub);
        expect(status).toBe(400);
        expect(payload.message).toContain('bookedThrough');
      });

      it('accepts bookedThrough on create alongside the required address', async () => {
        c.model.find = vi.fn(() => Promise.resolve([]));
        const created = vi.fn(() => Promise.resolve({ _id: 'x' }));
        c.model.create = created;
        await c.createVenue({
          user: 'agent', body: { name: 'Olde Salem Brewing', address: '1 Main St', bookedThrough: '2026-12-31' },
        }, resStub);
        expect(status).toBe(201);
        expect(created).toHaveBeenCalledWith(expect.objectContaining({ bookedThrough: '2026-12-31' }));
      });
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

    // #980 — derived, read-only bookingStatus: booked (upcoming linked gig) >
    // not-booking (active resumeBooking cooldown) > booking (otherwise).
    // Unit-tests the static helper directly (each branch + the precedence),
    // then confirms it's actually wired into the listVenues/getVenue payload.
    describe('computeBookingStatus (#980)', () => {
      const compute = (venue: any, hasUpcomingGig: boolean, now: number) => (
        (controller as any).constructor.computeBookingStatus(venue, hasUpcomingGig, now));

      it('booked — has an upcoming linked gig, regardless of anything else', () => {
        const now = Date.now();
        expect(compute({ resumeBooking: new Date(now + 1e9) }, true, now)).toBe('booked');
      });

      it('not-booking — an active (future) resumeBooking cooldown, no upcoming gig', () => {
        const now = Date.now();
        expect(compute({ resumeBooking: new Date(now + 1e9).toISOString() }, false, now)).toBe('not-booking');
      });

      it('booking — no upcoming gig, no active cooldown (default/open)', () => {
        const now = Date.now();
        expect(compute({}, false, now)).toBe('booking');
      });

      it('booking — resumeBooking already in the past does not count as active', () => {
        const now = Date.now();
        expect(compute({ resumeBooking: new Date(now - 1e9).toISOString() }, false, now)).toBe('booking');
      });

      it('booking — an invalid resumeBooking value is ignored, not treated as active', () => {
        const now = Date.now();
        expect(compute({ resumeBooking: 'not-a-date' }, false, now)).toBe('booking');
      });

      it('precedence: booked wins over an active resumeBooking cooldown', () => {
        const now = Date.now();
        expect(compute({ resumeBooking: new Date(now + 1e9) }, true, now)).toBe('booked');
      });

      // #995 — bookedThrough >= now ALSO drives not-booking, independent of
      // resumeBooking. Tested both sides of the >= now boundary.
      it('not-booking — bookedThrough exactly at now (boundary, inclusive)', () => {
        const now = Date.now();
        expect(compute({ bookedThrough: new Date(now) }, false, now)).toBe('not-booking');
      });

      it('not-booking — bookedThrough in the future, no upcoming gig', () => {
        const now = Date.now();
        expect(compute({ bookedThrough: new Date(now + 1e9).toISOString() }, false, now)).toBe('not-booking');
      });

      it('booking — bookedThrough just in the past (one ms before now) does not count as active', () => {
        const now = Date.now();
        expect(compute({ bookedThrough: new Date(now - 1).toISOString() }, false, now)).toBe('booking');
      });

      it('booking — an invalid bookedThrough value is ignored, not treated as active', () => {
        const now = Date.now();
        expect(compute({ bookedThrough: 'not-a-date' }, false, now)).toBe('booking');
      });

      it('precedence: booked wins over an active bookedThrough', () => {
        const now = Date.now();
        expect(compute({ bookedThrough: new Date(now + 1e9) }, true, now)).toBe('booked');
      });

      it('not-booking — both resumeBooking (future) and bookedThrough (future) set', () => {
        const now = Date.now();
        expect(compute({
          resumeBooking: new Date(now + 1e9), bookedThrough: new Date(now + 2e9),
        }, false, now)).toBe('not-booking');
      });

      it('booking — both resumeBooking and bookedThrough unset', () => {
        const now = Date.now();
        expect(compute({}, false, now)).toBe('booking');
      });

      it('is wired into listVenues: not-booking with an active bookedThrough, no upcoming gig, no resumeBooking', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: idA, name: 'Booked-Up Venue', bookedThrough: new Date(Date.now() + 1e10).toISOString() },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('not-booking');
      });

      it('is wired into listVenues: booking with a bookedThrough already in the past', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: idA, name: 'Reopened Venue', bookedThrough: new Date(Date.now() - 1e10).toISOString() },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('booking');
      });

      it('is wired into listVenues: booked when there is an upcoming linked gig', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'Booked Venue' }]));
        (gigModel as any).find = vi.fn(() => Promise.resolve([
          { venueId: idA, datetime: new Date(Date.now() + 86400000).toISOString() },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('booked');
      });

      it('is wired into listVenues: not-booking with an active resumeBooking, no upcoming gig', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([
          { _id: idA, name: 'Paused Venue', resumeBooking: new Date(Date.now() + 1e10).toISOString() },
        ]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('not-booking');
      });

      it('is wired into listVenues: booking otherwise', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'Open Venue' }]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('booking');
      });

      it('overrides a stale stored bookingStatus with the computed value', async () => {
        const idA = new mongoose.Types.ObjectId().toString();
        c.model.find = vi.fn(() => Promise.resolve([{ _id: idA, name: 'Stale Venue', bookingStatus: 'booked' }]));
        await c.listVenues({ user: 'a', query: {} }, resStub);
        expect(payload[0].bookingStatus).toBe('booking');
      });
    });
  });

  describe('listCities — GET /venue/cities (#980)', () => {
    // Reassign just `Schema.distinct` (not the whole Schema object — the
    // real Model also carries `.collection`, which the migration scripts'
    // tests rely on and which this repo's other spec files share via the
    // same facade singleton, fileParallelism:false) and restore it after
    // each test so nothing leaks into other spec files.
    let originalDistinct: typeof venueModel.Schema.distinct;
    beforeEach(() => { originalDistinct = venueModel.Schema.distinct; });
    afterEach(() => { venueModel.Schema.distinct = originalDistinct; });

    it('403s without a venue capability', async () => {
      asAgent([]);
      await c.listCities({ user: 'a', query: {} }, resStub);
      expect(status).toBe(403);
    });

    it('returns distinct non-empty cities, sorted', async () => {
      const distinctSpy = vi.fn(() => Promise.resolve(['Roanoke', '', 'Salem', null, 'Blacksburg']));
      (venueModel.Schema as any).distinct = distinctSpy;
      await c.listCities({ user: 'a', query: {} }, resStub);
      expect(status).toBe(200);
      expect(distinctSpy).toHaveBeenCalledWith('city', { city: { $nin: [null, ''] } });
      expect(payload).toEqual(['Blacksburg', 'Roanoke', 'Salem']);
    });

    it('500s when the distinct query throws', async () => {
      (venueModel.Schema as any).distinct = vi.fn(() => Promise.reject(new Error('db down')));
      await c.listCities({ user: 'a', query: {} }, resStub);
      expect(status).toBe(500);
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

    it('filters by the vetting tag interested (#843)', () => {
      const f = (controller as any).constructor.buildListFilter({ interested: 'true' });
      expect(f).toMatchObject({ interested: true });
      const g = (controller as any).constructor.buildListFilter({ interested: 'false' });
      expect(g).toMatchObject({ interested: false });
    });

    // #954 — inScope was dropped entirely; ?inScope=... must no longer surface
    // in the built filter (it's just an unrecognized query param now).
    it('no longer supports an inScope filter (#954)', () => {
      const f = (controller as any).constructor.buildListFilter({ inScope: 'true' });
      expect(f).not.toHaveProperty('inScope');
    });

    // #980 — bookingStatus is derived/read-only now; a stored-field Mongo
    // filter is no longer reliable, so it's no longer built into the query.
    it('no longer supports a bookingStatus filter (#980)', () => {
      const f = (controller as any).constructor.buildListFilter({ bookingStatus: 'booking' });
      expect(f).not.toHaveProperty('bookingStatus');
    });
  });

  describe('vetting tags (#843)', () => {
    // #980 — bookingStatus is no longer validated (it's derived/read-only —
    // stripped before validateBody ever sees it), so an invalid value is
    // silently ignored rather than rejected.
    it('silently strips an invalid bookingStatus instead of rejecting it (#980)', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'v11' }));
      c.model.create = create;
      await c.createVenue({ user: 'a', body: { name: 'X', address: '1 Main St', bookingStatus: 'bogus' } }, resStub);
      expect(status).toBe(201);
      expect((create.mock.calls[0] as unknown[])[0]).not.toHaveProperty('bookingStatus');
    });

    it('persists the vetting tags on create', async () => {
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'v10' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a',
        body: {
          name: 'Olde Salem', address: '1 Main St', interested: false, payTier: 'low',
        },
      }, resStub);
      expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
        interested: false, payTier: 'low',
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
      c.model.find = vi.fn(() => Promise.resolve([]));
      const create = vi.fn(() => Promise.resolve({ _id: 'v9' }));
      c.model.create = create;
      await c.createVenue({
        user: 'a', body: {
          name: 'The Spot', address: '1 Main St', venueType: 'Originals', outreachEligible: true,
        },
      }, resStub);
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

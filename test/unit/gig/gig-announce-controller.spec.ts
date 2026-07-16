/* eslint-disable @typescript-eslint/no-explicit-any */
// Unit tests for POST /gig/:id/announce and GET /gig/promo-default.jpg (#962).
// The Meta Graph API clients are mocked at the module boundary — meta-publish
// itself (mocked HTTP) is covered separately in test/unit/lib/meta-publish.spec.ts.
// NEVER a real network/Meta call here, per the repo's hard safety rule.
import mongoose from 'mongoose';
import fs from 'fs';
import controller from '#src/model/gig/gig-controller.js';
import userModel from '#src/model/user/user-facade.js';
import * as metaPublish from '#src/lib/meta-publish.js';

vi.mock('#src/lib/meta-publish.js', () => ({
  publishToInstagram: vi.fn(),
  publishToFacebookPage: vi.fn(),
  isMetaFullyUnconfigured: vi.fn(() => false),
}));

const c = controller as any;
const mp = metaPublish as any;

describe('GigController — announce (#962)', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => {
      status = s;
      return { json: (obj: any) => { payload = obj; return obj; } };
    },
  };

  // Default: an admin identity holding the announce capability.
  const asAgent = (privileges = ['gig:announce']) => {
    (userModel as any).findById = vi.fn(() => Promise.resolve({ privileges }));
  };

  beforeEach(() => {
    status = 0;
    payload = undefined;
    asAgent();
    mp.isMetaFullyUnconfigured.mockReturnValue(false);
    mp.publishToInstagram.mockResolvedValue({ ok: true, id: 'ig-1' });
    mp.publishToFacebookPage.mockResolvedValue({ ok: true, id: 'fb-1' });
  });

  describe('authorize', () => {
    it('403s when the capability is missing', async () => {
      asAgent(['unrelated:cap']);
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({
        user: 'a', params: { id }, body: { caption: '<p>Hi</p>' },
      }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toContain('gig:announce');
    });

    it('401s when the user is not found', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve(null));
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(401);
    });

    it('500s when the user lookup itself errors', async () => {
      (userModel as any).findById = vi.fn(() => Promise.reject(new Error('db down')));
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(500);
    });

    it('403s a privilege-less user whose role is not in the admin allow-list', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve({ userType: 'user', privileges: [] }));
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(403);
      expect(payload.message).toContain('not authorized for gig announce');
    });

    it('allows a privilege-less admin via role fallback', async () => {
      (userModel as any).findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin', privileges: [] }));
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({ _id: id }));
      await c.announce({
        user: 'a', params: { id }, body: { caption: 'Hi' }, protocol: 'http', get: () => 'localhost',
      }, resStub);
      expect(status).toBe(200);
    });
  });

  describe('validation', () => {
    it('rejects an invalid id', async () => {
      await c.announce({ user: 'a', params: { id: 'nope' }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('invalid');
    });

    it('rejects a missing caption', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: {} }, resStub);
      expect(status).toBe(400);
      expect(payload.message).toContain('caption is required');
    });

    it('rejects a blank caption', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: { caption: '   ' } }, resStub);
      expect(status).toBe(400);
    });

    it('500s with a clear message when Meta is fully unconfigured', async () => {
      mp.isMetaFullyUnconfigured.mockReturnValue(true);
      const id = new mongoose.Types.ObjectId().toString();
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(500);
      expect(payload.message).toContain('META_IG_USER_ID');
      expect(payload.message).toContain('META_FB_PAGE_ACCESS_TOKEN');
      expect(mp.publishToInstagram).not.toHaveBeenCalled();
    });

    it('500s when the gig lookup errors', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.reject(new Error('db down')));
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(500);
    });

    it('400s when the gig does not exist', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve(null));
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(400);
    });
  });

  describe('image fallback chain', () => {
    const req = (id: string, body: any) => ({
      user: 'a', params: { id }, body, protocol: 'http', get: (h: string) => (h === 'host' ? 'localhost:7000' : undefined),
    });

    it('prefers an explicit body.imageUrl', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      await c.announce(req(id, { caption: 'Hi', imageUrl: 'https://explicit.example/img.jpg' }), resStub);
      expect(mp.publishToInstagram).toHaveBeenCalledWith(expect.any(String), 'https://explicit.example/img.jpg');
      expect(mp.publishToFacebookPage).toHaveBeenCalledWith(expect.any(String), 'https://explicit.example/img.jpg');
    });

    it('falls back to the gig promoImageUrl when no imageUrl given', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      await c.announce(req(id, { caption: 'Hi' }), resStub);
      expect(mp.publishToInstagram).toHaveBeenCalledWith(expect.any(String), 'https://gig.example/promo.jpg');
    });

    it('falls back to the default promo image URL when neither is set', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      await c.announce(req(id, { caption: 'Hi' }), resStub);
      expect(mp.publishToInstagram).toHaveBeenCalledWith(expect.any(String), 'http://localhost:7000/gig/promo-default.jpg');
    });
  });

  describe('caption conversion', () => {
    it('converts the TinyMCE HTML caption to plain text before publishing', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.resolve({}));
      await c.announce({
        user: 'a', params: { id }, body: { caption: '<p>Big show <a href="https://x.example">tonight</a>!</p>' },
      }, resStub);
      expect(mp.publishToInstagram).toHaveBeenCalledWith('Big show https://x.example!', expect.any(String));
      expect(mp.publishToFacebookPage).toHaveBeenCalledWith('Big show https://x.example!', expect.any(String));
    });
  });

  describe('per-leg isolation + announcedAt stamping', () => {
    it('stamps announcedAt when both legs succeed', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      const upd = vi.fn(() => Promise.resolve({}));
      c.model.findByIdAndUpdate = upd;
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(200);
      expect(payload).toEqual({ instagram: { ok: true, id: 'ig-1' }, facebook: { ok: true, id: 'fb-1' } });
      expect(upd).toHaveBeenCalledWith(id, { announcedAt: expect.any(Date) });
    });

    it('reports partial failure without failing the request, and still stamps on one success', async () => {
      mp.publishToInstagram.mockResolvedValue({ ok: false, error: 'token expired' });
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      const upd = vi.fn(() => Promise.resolve({}));
      c.model.findByIdAndUpdate = upd;
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(200);
      expect(payload.instagram).toEqual({ ok: false, error: 'token expired' });
      expect(payload.facebook).toEqual({ ok: true, id: 'fb-1' });
      expect(upd).toHaveBeenCalled();
    });

    it('does not stamp announcedAt when both legs fail', async () => {
      mp.publishToInstagram.mockResolvedValue({ ok: false, error: 'down' });
      mp.publishToFacebookPage.mockResolvedValue({ ok: false, error: 'down' });
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      const upd = vi.fn(() => Promise.resolve({}));
      c.model.findByIdAndUpdate = upd;
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(200);
      expect(payload).toEqual({ instagram: { ok: false, error: 'down' }, facebook: { ok: false, error: 'down' } });
      expect(upd).not.toHaveBeenCalled();
    });

    it('never lets a stamping failure mask the publish result', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      c.model.findById = vi.fn(() => Promise.resolve({ _id: id, promoImageUrl: 'https://gig.example/promo.jpg' }));
      c.model.findByIdAndUpdate = vi.fn(() => Promise.reject(new Error('stamp write failed')));
      await c.announce({ user: 'a', params: { id }, body: { caption: 'Hi' } }, resStub);
      expect(status).toBe(200);
      expect(payload.instagram.ok).toBe(true);
      expect(payload.facebook.ok).toBe(true);
    });
  });

  describe('getDefaultPromoImage', () => {
    it('serves the bundled asset via sendFile', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const sendFile = vi.fn();
      await c.getDefaultPromoImage({}, { ...resStub, sendFile });
      expect(sendFile).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('404s when the asset is missing on disk', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      await c.getDefaultPromoImage({}, resStub);
      expect(status).toBe(404);
      vi.restoreAllMocks();
    });
  });
});

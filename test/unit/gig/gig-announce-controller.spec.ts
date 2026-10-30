import type { Request, Response } from 'express';
import fs from 'node:fs';
import controller from '#src/model/gig/gig-controller.js';
import userModel from '#src/model/user/user-facade.js';
import { getInstagramKey } from '#src/lib/instagram-key.js';
import { publishToInstagram } from '#src/lib/meta-publish.js';
vi.mock('#src/lib/instagram-key.js', () => ({ getInstagramKey: vi.fn() }));
vi.mock('#src/lib/meta-publish.js', () => ({ publishToInstagram: vi.fn() }));
const c = controller as unknown as {
  model: { findById(id: string): Promise<unknown>; findByIdAndUpdate(id: string, changes: unknown): Promise<unknown> };
  announce(req: Request, res: Response): Promise<unknown>;
  getDefaultPromoImage(req: Request, res: Response): Promise<unknown>;
};
const id = '507f1f77bcf86cd799439011';
const key = { userId: 'account', accessToken: 'fixture-key', issuedAt: new Date() };
describe('Gig announce', () => {
  let res: Response;
  beforeEach(() => {
    res = { status: vi.fn().mockReturnThis(), json: vi.fn(), sendFile: vi.fn() } as unknown as Response;
    vi.spyOn(userModel, 'findById').mockResolvedValue({ privileges: ['gig:announce'] });
    vi.spyOn(c.model, 'findById').mockResolvedValue({ promoImageUrl: 'https://example.com/promo.png' });
    vi.spyOn(c.model, 'findByIdAndUpdate').mockResolvedValue({});
    vi.mocked(getInstagramKey).mockResolvedValue(key);
    vi.mocked(publishToInstagram).mockResolvedValue({ ok: true, id: 'post' });
  });
  afterEach(() => vi.restoreAllMocks());
  const announce = (body: unknown, gigId = id) => c.announce({
    user: 'admin', params: { id: gigId }, body, protocol: 'http', get: () => 'localhost:7000',
  } as unknown as Request, res);
  it('saves the source before publishing the public JPEG with both tags', async () => {
    await announce({ caption: '<p>Hi <a href="https://example.com">there</a></p>', imageUrl: 'https://example.com/custom.png',
      userTags: ['chemmariasherman', 'venue.name'] });
    expect(c.model.findByIdAndUpdate).toHaveBeenNthCalledWith(1, id, { announceImageUrl: 'https://example.com/custom.png' });
    expect(publishToInstagram).toHaveBeenCalledWith('Hi https://example.com', `http://localhost:7000/gig/${id}/announce-image.jpg`, [
      { username: 'chemmariasherman', x: 0.25, y: 0.85 }, { username: 'venue.name', x: 0.75, y: 0.85 },
    ], key);
    expect(c.model.findByIdAndUpdate).toHaveBeenNthCalledWith(2, id, { announcedAt: expect.any(Date) });
    expect(res.json).toHaveBeenCalledWith({ instagram: { ok: true, id: 'post' } });
  });
  it('uses the gig source and preserves the venue position when Maria is cleared', async () => {
    await announce({ caption: 'Hi', userTags: ['', 'venue'] });
    expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(id, { announceImageUrl: 'https://example.com/promo.png' });
    expect(publishToInstagram).toHaveBeenCalledWith('Hi', expect.any(String), [{ username: 'venue', x: 0.75, y: 0.85 }], key);
  });
  it('uses the default source and accepts omitted tags', async () => {
    vi.mocked(c.model.findById).mockResolvedValue({});
    await announce({ caption: 'Hi' });
    expect(c.model.findByIdAndUpdate).toHaveBeenCalledWith(id, { announceImageUrl: 'http://localhost:7000/gig/promo-default.jpg' });
    expect(publishToInstagram).toHaveBeenCalledWith('Hi', expect.any(String), [], key);
  });
  it.each([
    {}, { caption: 1 }, { caption: ' ' }, { caption: 'Hi', imageUrl: {} },
    { caption: 'Hi', imageUrl: 'not-a-url' }, { caption: 'Hi', imageUrl: 'ftp://example.com/image.jpg' }, { caption: 'Hi', imageUrl: '' },
    ...['@venue', 'bad name', 'a'.repeat(31), 1, null, {}].map((tag) => ({ caption: 'Hi', userTags: [tag] })),
    { caption: 'Hi', userTags: 'venue' }, { caption: 'Hi', userTags: ['a', 'b', 'c'] },
  ])('refuses malformed input without publishing: %j', async (body) => {
    await announce(body);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it('rejects invalid ids', async () => {
    await announce({ caption: 'Hi' }, 'invalid');
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it.each([[null, 401], [{ privileges: ['other'] }, 403], [{ userType: 'user' }, 403]])('refuses unauthorized users', async (user, status) => {
    vi.mocked(userModel.findById).mockResolvedValue(user);
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(status);
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it('allows the admin role fallback', async () => {
    vi.mocked(userModel.findById).mockResolvedValue({ userType: 'JaM-admin' });
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it('reports an authorization lookup error', async () => {
    vi.mocked(userModel.findById).mockRejectedValue(new Error('db unavailable'));
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it('reports absent configuration without publishing', async () => {
    vi.mocked(getInstagramKey).mockResolvedValue(null);
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Instagram announce is not configured' });
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it('handles an unreadable key without publishing', async () => {
    vi.mocked(getInstagramKey).mockRejectedValue(new Error('db unavailable'));
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it.each([null, new Error('lookup failed')])('handles a missing or unreadable gig', async (result) => {
    if (result instanceof Error) vi.mocked(c.model.findById).mockRejectedValue(result);
    else vi.mocked(c.model.findById).mockResolvedValue(result);
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(result ? 500 : 400);
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it('does not publish when saving the source fails', async () => {
    vi.mocked(c.model.findByIdAndUpdate).mockRejectedValue(new Error('db unavailable'));
    await announce({ caption: 'Hi' });
    expect(res.status).toHaveBeenCalledWith(500);
    expect(publishToInstagram).not.toHaveBeenCalled();
  });
  it('passes through refusal without stamping announcedAt', async () => {
    vi.mocked(publishToInstagram).mockResolvedValue({ ok: false, error: 'tag refused' });
    await announce({ caption: 'Hi' });
    expect(c.model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ instagram: { ok: false, error: 'tag refused' } });
  });
  it('preserves success when the stamp fails', async () => {
    vi.mocked(c.model.findByIdAndUpdate).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db unavailable'));
    await announce({ caption: 'Hi' });
    expect(res.json).toHaveBeenCalledWith({ instagram: { ok: true, id: 'post' } });
  });
  it.each([true, false])('serves the default photo or returns 404', async (exists) => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(exists);
    await c.getDefaultPromoImage({} as Request, res);
    if (exists) expect(res.sendFile).toHaveBeenCalled();
    else expect(res.status).toHaveBeenCalledWith(404);
  });
});

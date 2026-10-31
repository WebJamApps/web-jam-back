import app from '#src/index.js';
import GigModel from '#src/model/gig/gig-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import * as metaPublish from '#src/lib/meta-publish.js';
import { getInstagramKey } from '#src/lib/instagram-key.js';
import request from '../../helpers/api.js';

vi.mock('#src/lib/meta-publish.js', () => ({
  publishToInstagram: vi.fn(),
}));
vi.mock('#src/lib/instagram-key.js', () => ({ getInstagramKey: vi.fn(), startInstagramRefresh: vi.fn() }));
const key = { userId: 'account', accessToken: 'fixture-key', issuedAt: new Date() };

describe('Granting gig:announce through /admin/user', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  const emails = ['announce-grant-admin@example.com', 'announce-grant-recipient@example.com'];
  let adminId: string;

  beforeEach(async () => {
    await userModel.deleteMany({ email: { $in: emails } });
    const admin = await userModel.create({ name: 'Grant admin', email: emails[0], userType: 'Developer' });
    adminId = String(admin._id);
    vi.mocked(getInstagramKey).mockResolvedValue(key);
    vi.mocked(metaPublish.publishToInstagram).mockResolvedValue({ ok: true, id: 'grant-ig' });
  });

  afterEach(async () => {
    await userModel.deleteMany({ email: { $in: emails } });
    await GigModel.deleteMany({ venue: 'Announce grant fixture' });
  });

  it.each(['create', 'update'])('grants the capability on %s and authorizes an announcement', async (action) => {
    const recipient = { name: 'Announcer', email: emails[1] };
    let grantRequest;
    if (action === 'create') {
      grantRequest = request(app).post('/admin/user').send({ ...recipient, privileges: ['gig:announce'] });
    } else {
      const existing = await userModel.create(recipient);
      const refused = await request(app).post('/gig/not-an-id/announce').set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT({ _id: String(existing._id) })}`)
        .send({ caption: 'Test announcement' });
      expect(refused.status).toBe(403);
      grantRequest = request(app).put(`/admin/user/${existing._id}`).send({ privileges: ['gig:announce'] });
    }
    const grant = await grantRequest.set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminId })}`);
    expect(grant.status).toBe(action === 'create' ? 201 : 200);
    expect(grant.body.privileges).toEqual(['gig:announce']);
    const stored = await userModel.findById(String(grant.body._id));
    expect(stored?.privileges).toEqual(['gig:announce']);

    const gig = await GigModel.create({ venue: 'Announce grant fixture', promoImageUrl: 'https://example.com/grant.jpg' });
    const response = await request(app).post(`/gig/${gig._id}/announce`).set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: String(grant.body._id) })}`)
      .send({ caption: 'Test announcement' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ instagram: { ok: true, id: 'grant-ig' } });
    expect(metaPublish.publishToInstagram).toHaveBeenCalledExactlyOnceWith('Test announcement',
      expect.stringContaining(`/gig/${gig._id}/announce-image.jpg`), [], key);
    expect((await GigModel.findById(String(gig._id)))?.announcedAt).toBeTruthy();
  });
});

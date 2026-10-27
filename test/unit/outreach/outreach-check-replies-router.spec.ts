import app from '#src/index.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request from '../../helpers/api.js';

describe('POST /outreach/check-replies (retired route #1171)', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  let adminId: string;

  beforeEach(async () => {
    await userModel.deleteMany({ email: 'check-replies-admin@example.com' });
    const admin = await userModel.create({
      name: 'Check replies test admin', email: 'check-replies-admin@example.com', userType: 'Developer',
    });
    adminId = String(admin._id);
  });

  afterEach(async () => {
    await userModel.deleteMany({ email: 'check-replies-admin@example.com' });
  });

  it('answers 404 Not Found when requested with admin auth', async () => {
    const response = await request(app)
      .post('/outreach/check-replies')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: adminId })}`);
    expect(response.status).toBe(404);
  });

  it('answers 404 Not Found when requested without auth', async () => {
    const response = await request(app)
      .post('/outreach/check-replies')
      .set({ origin: allowedUrl });
    expect(response.status).toBe(404);
  });
});

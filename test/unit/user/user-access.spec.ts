// Route-level access rules for /user (web-jam-back#1110), run through the real
// router and Mongo. ensureAuthenticated is stubbed to stand in for each caller.
import authUtils from '#src/auth/authUtils.js';
import app from '#src/index.js';
import userModel from '#src/model/user/user-facade.js';
import request from '../../helpers/api.js';

type Caller = { user?: string; userType?: string };

function actAs(caller: Caller) {
  authUtils.ensureAuthenticated = vi.fn((req: Caller) => {
    req.user = caller.user;
    req.userType = caller.userType;
    return Promise.resolve();
  }) as unknown as typeof authUtils.ensureAuthenticated;
}

describe('/user access rules', () => {
  const originalEnsure = authUtils.ensureAuthenticated;
  let artistAdminId: string;
  let superAdminId: string;

  beforeEach(async () => {
    await userModel.deleteMany({ email: /@example-user-access\.com$/ });
    const artistAdmin = await userModel.create({
      name: 'artist-admin', email: 'artist@example-user-access.com', userType: 'clc-admin',
    }) as unknown as { _id: { toString(): string } };
    const superAdmin = await userModel.create({
      name: 'super-admin', email: 'super@example-user-access.com', userType: 'JaM-admin',
    }) as unknown as { _id: { toString(): string } };
    artistAdminId = artistAdmin._id.toString();
    superAdminId = superAdmin._id.toString();
  });

  afterAll(async () => {
    authUtils.ensureAuthenticated = originalEnsure;
    await userModel.deleteMany({ email: /@example-user-access\.com$/ });
  });

  it('PUT /user/:id cannot promote your own account, and nothing is written', async () => {
    actAs({ user: artistAdminId, userType: 'clc-admin' });
    const r = await request(app).put(`/user/${artistAdminId}`)
      .send({ userType: 'JaM-admin', privileges: ['outreach:approve'] });
    expect(r.status).toBe(403);
    const stored = await userModel.findById(artistAdminId) as unknown as { userType: string; privileges?: string[] };
    expect(stored.userType).toBe('clc-admin');
    expect(stored.privileges || []).not.toContain('outreach:approve');
  });

  it('PUT /user/:id is refused even for a super-admin', async () => {
    actAs({ user: superAdminId, userType: 'JaM-admin' });
    const r = await request(app).put(`/user/${artistAdminId}`).send({ name: 'renamed' });
    expect(r.status).toBe(403);
    const stored = await userModel.findById(artistAdminId) as unknown as { name: string };
    expect(stored.name).toBe('artist-admin');
  });

  it('DELETE /user/:id is refused and the record still exists', async () => {
    for (const caller of [{ user: artistAdminId, userType: 'clc-admin' }, { user: superAdminId, userType: 'Developer' }]) {
      actAs(caller);
      const r = await request(app).delete(`/user/${superAdminId}`);
      expect(r.status).toBe(403);
    }
    expect(await userModel.findById(superAdminId)).not.toBeNull();
  });

  it('GET /user/:id returns your own record, refuses another user, and lets an admin read any', async () => {
    actAs({ user: artistAdminId, userType: 'clc-admin' });
    let r = await request(app).get(`/user/${artistAdminId}`);
    expect(r.status).toBe(200);
    expect(r.body.email).toBe('artist@example-user-access.com');

    r = await request(app).get(`/user/${superAdminId}`);
    expect(r.status).toBe(403);
    expect(r.body.email).toBeUndefined();

    actAs({ user: superAdminId, userType: 'JaM-admin' });
    r = await request(app).get(`/user/${artistAdminId}`);
    expect(r.status).toBe(200);
  });

  it('POST /user (lookup by email) is admin-only', async () => {
    actAs({ user: artistAdminId, userType: 'tim-admin' });
    let r = await request(app).post('/user').send({ email: 'super@example-user-access.com' });
    expect(r.status).toBe(403);
    expect(r.body.email).toBeUndefined();

    actAs({ user: superAdminId, userType: 'Developer' });
    r = await request(app).post('/user').send({ email: 'artist@example-user-access.com' });
    expect(r.status).toBe(200);
  });

  it('refuses every route when the caller lookup fails, and writes nothing', async () => {
    authUtils.ensureAuthenticated = vi.fn(() => Promise.reject(new Error('token does not match any existing user'))) as unknown as typeof authUtils.ensureAuthenticated;
    const results = await Promise.all([
      request(app).get(`/user/${artistAdminId}`),
      request(app).put(`/user/${artistAdminId}`).send({ userType: 'JaM-admin' }),
      request(app).delete(`/user/${artistAdminId}`),
      request(app).post('/user').send({ email: 'artist@example-user-access.com' }),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    const stored = await userModel.findById(artistAdminId) as unknown as { userType: string };
    expect(stored.userType).toBe('clc-admin');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import app from '#src/index.js';
import request from '../../helpers/api.js';
import authUtils from '#src/auth/authUtils.js';
import userModel from '#src/model/user/user-facade.js';
import FacebookToken from '#src/model/facebook/facebook-schema.js';
import * as mailer from '#src/lib/mailer.js';
import {
  updateFacebookCache, migrateLegacyToken, __reset, __getState, FB_GRAPH_VERSION,
} from '#src/model/facebook/FacebookController.js';

// Intercept only Graph API calls; pass the test client's own HTTP through.
const realFetch = globalThis.fetch.bind(globalThis);
const jsonRes = (body: any) => ({ ok: true, json: async () => body });

function stubGraph(...responses: any[]) {
  const fb = vi.fn();
  responses.forEach((r) => fb.mockResolvedValueOnce(r));
  vi.stubGlobal('fetch', (url: any, init: any) => (
    String(url).startsWith('https://graph.facebook.com') ? fb(String(url)) : realFetch(url, init)
  ));
  return fb;
}

describe('Facebook feed API', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  const CLC = '202368653220334'; // back-compat default page (CollegeLutheran)
  const WJ = '111111111111111'; // second page (WebJamLLC)
  let user: { _id: string };
  const origPageId = process.env.FB_PAGE_ID;
  const origPages = process.env.FB_PAGES;

  // Recreate the admin user before every test (scoped to this email so we don't
  // disturb other specs that share the test DB), so a parallel spec deleting
  // users mid-file can't make later auth-dependent tests 401.
  beforeEach(async () => {
    __reset();
    await FacebookToken.deleteMany({});
    await userModel.deleteMany({ email: 'fbadmin@example.com' });
    const created = await userModel.create({
      name: 'fbadmin', email: 'fbadmin@example.com', userType: 'Developer',
    }) as unknown as { _id: { toString(): string } };
    user = { _id: created._id.toString() };
    process.env.FB_PAGE_ID = CLC;
    process.env.FB_PAGES = JSON.stringify({ [CLC]: 'CollegeLutheran', [WJ]: 'WebJamLLC' });
    process.env.FB_APP_ID = 'appid';
    process.env.FB_APP_SECRET = 'secret';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (origPageId === undefined) delete process.env.FB_PAGE_ID; else process.env.FB_PAGE_ID = origPageId;
    if (origPages === undefined) delete process.env.FB_PAGES; else process.env.FB_PAGES = origPages;
  });
  afterAll(async () => { await userModel.deleteMany({ email: 'fbadmin@example.com' }); await FacebookToken.deleteMany({}); });

  it('pins a Graph API version', () => { expect(FB_GRAPH_VERSION).toMatch(/^v\d+\.\d+$/); });

  it('GET /facebook/feed is public and returns the empty cache initially', async () => {
    const r = await request(app).get('/facebook/feed').set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ posts: [], lastUpdated: null });
  });

  it('PUT /facebook/token rejects an unauthenticated request', async () => {
    const r = await request(app).put('/facebook/token').set({ origin: allowedUrl }).send({ userToken: 'x' });
    expect(r.status).toBe(401);
  });

  it('PUT /facebook/token requires a userToken in the body', async () => {
    const r = await request(app)
      .put('/facebook/token')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: user._id })}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/userToken/);
  });

  it('PUT /facebook/token exchanges the token, stores it, and primes the cache', async () => {
    const fb = stubGraph(
      jsonRes({ access_token: 'long-lived-user-token' }), // fb_exchange_token
      jsonRes({ access_token: 'PAGE-TOKEN' }), // GET /{pageId}?fields=access_token
      jsonRes({ data: [{ id: 'p1', message: 'Hello', permalink_url: 'https://fb/p1', created_time: '2026-06-01T00:00:00Z' }] }), // /posts
    );
    const r = await request(app)
      .put('/facebook/token')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: user._id })}`)
      .send({ userToken: 'short-lived' });
    expect(r.status).toBe(200);
    expect(r.body.lastUpdated).toBeTruthy();
    expect(fb).toHaveBeenCalledTimes(3);

    const stored = await FacebookToken.findOne({ pageId: CLC }).lean().exec() as any;
    expect(stored.value).toBe('PAGE-TOKEN');

    const feed = await request(app).get('/facebook/feed').set({ origin: allowedUrl });
    expect(feed.body.posts).toHaveLength(1);
    expect(feed.body.posts[0].message).toBe('Hello');
  });

  it('PUT /facebook/token returns 400 when the page token is not available', async () => {
    stubGraph(
      jsonRes({ access_token: 'long-lived-user-token' }),
      jsonRes({ error: { code: 100, message: 'Unsupported get request' } }),
    );
    const r = await request(app)
      .put('/facebook/token')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: user._id })}`)
      .send({ userToken: 'short-lived' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Unsupported get request/i);
  });

  it('PUT /facebook/token returns 400 on a failed token exchange', async () => {
    stubGraph(jsonRes({ error: { code: 190, message: 'bad token' } }));
    const r = await request(app)
      .put('/facebook/token')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: user._id })}`)
      .send({ userToken: 'short-lived' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/bad token/);
  });

  it('updateFacebookCache skips quietly when no token is stored', async () => {
    const fb = stubGraph();
    await updateFacebookCache();
    expect(fb).not.toHaveBeenCalled();
    expect(__getState().cache).toEqual({ posts: [], lastUpdated: null });
  });

  it('updateFacebookCache keeps the last good cache and emails once on a dead token (190)', async () => {
    const mail = vi.spyOn(mailer, 'sendMail').mockResolvedValue({ messageId: 'test' });
    await FacebookToken.create({ pageId: CLC, value: 'PAGE-TOKEN' });

    // First a healthy refresh to populate the cache.
    stubGraph(jsonRes({ data: [{ id: 'p1', message: 'Good' }] }));
    await updateFacebookCache();
    expect(__getState().cache.posts).toHaveLength(1);
    vi.unstubAllGlobals();

    // Token dies: cache is preserved, one email sent.
    stubGraph(jsonRes({ error: { code: 190, message: 'expired' } }), jsonRes({ error: { code: 190 } }));
    await updateFacebookCache();
    await updateFacebookCache(); // second outage refresh must NOT re-email
    expect(__getState().cache.posts).toHaveLength(1); // last good cache kept
    expect(__getState().alertSent).toBe(true);
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it('re-arms the alert after a successful refresh', async () => {
    vi.spyOn(mailer, 'sendMail').mockResolvedValue({ messageId: 'test' });
    await FacebookToken.create({ pageId: CLC, value: 'PAGE-TOKEN' });
    stubGraph(jsonRes({ error: { code: 190, message: 'expired' } }), jsonRes({ data: [{ id: 'p2' }] }));
    await updateFacebookCache();
    expect(__getState().alertSent).toBe(true);
    await updateFacebookCache(); // healthy
    expect(__getState().alertSent).toBe(false);
  });

  it('ignores non-190 Graph errors without emailing', async () => {
    const mail = vi.spyOn(mailer, 'sendMail').mockResolvedValue({ messageId: 'test' });
    await FacebookToken.create({ pageId: CLC, value: 'PAGE-TOKEN' });
    stubGraph(jsonRes({ error: { code: 4, message: 'rate limited' } }));
    await updateFacebookCache();
    expect(mail).not.toHaveBeenCalled();
    expect(__getState().alertSent).toBe(false);
  });

  it('keeps the last good cache when fetch itself throws', async () => {
    await FacebookToken.create({ pageId: CLC, value: 'PAGE-TOKEN' });
    vi.stubGlobal('fetch', (url: any, init: any) => (
      String(url).startsWith('https://graph.facebook.com')
        ? Promise.reject(new Error('network down'))
        : realFetch(url, init)
    ));
    await updateFacebookCache();
    expect(__getState().cache).toEqual({ posts: [], lastUpdated: null });
  });

  it('serves a second page independently via ?pageId and stores its own token', async () => {
    const fb = stubGraph(
      jsonRes({ access_token: 'long-lived-user-token' }),
      jsonRes({ access_token: 'WJ-PAGE-TOKEN' }),
      jsonRes({ data: [{ id: 'w1', message: 'WebJam post' }] }),
    );
    const r = await request(app)
      .put('/facebook/token')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: user._id })}`)
      .send({ userToken: 'short-lived', pageId: WJ });
    expect(r.status).toBe(200);
    expect(r.body.pageId).toBe(WJ);
    expect(fb).toHaveBeenCalledTimes(3);

    const stored = await FacebookToken.findOne({ pageId: WJ }).lean().exec() as any;
    expect(stored.value).toBe('WJ-PAGE-TOKEN');

    const wj = await request(app).get('/facebook/feed').query({ pageId: WJ }).set({ origin: allowedUrl });
    expect(wj.body.posts[0].message).toBe('WebJam post');
    // The CLC (default) feed is untouched and still empty.
    const clc = await request(app).get('/facebook/feed').set({ origin: allowedUrl });
    expect(clc.body).toEqual({ posts: [], lastUpdated: null });
  });

  it('names the specific page in the dead-token alert email', async () => {
    const mail = vi.spyOn(mailer, 'sendMail').mockResolvedValue({ messageId: 'test' });
    await FacebookToken.create({ pageId: WJ, value: 'WJ-TOKEN' });
    stubGraph(jsonRes({ error: { code: 190, message: 'expired' } }));
    await updateFacebookCache();
    expect(mail).toHaveBeenCalledTimes(1);
    expect((mail.mock.calls[0][0] as { subject: string }).subject).toMatch(/WebJamLLC/);
    expect(__getState(WJ).alertSent).toBe(true);
  });

  it('migrates the legacy single-page token doc to the CLC pageId (idempotent)', async () => {
    await FacebookToken.collection.insertOne({ key: 'pageToken', value: 'LEGACY-TOKEN' });
    await migrateLegacyToken();
    const migrated = await FacebookToken.findOne({ pageId: CLC }).lean().exec() as any;
    expect(migrated.value).toBe('LEGACY-TOKEN');
    expect(await FacebookToken.collection.findOne({ key: 'pageToken' })).toBeNull();
    await migrateLegacyToken(); // second run is a no-op
    expect(await FacebookToken.countDocuments({ pageId: CLC })).toBe(1);
  });

  it('should wait until async work settles before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => setTimeout(() => resolve(true), 1000));
  });
});

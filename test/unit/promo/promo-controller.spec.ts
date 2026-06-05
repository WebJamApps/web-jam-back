/* eslint-disable @typescript-eslint/no-explicit-any */
import controller from '../../../src/model/promo/promo-controller.js';
import userModel from '../../../src/model/user/user-facade.js';
import subscriberModel from '../../../src/model/subscriber/subscriber-facade.js';

vi.mock('#src/lib/mailer.js', () => ({
  sendMail: vi.fn(() => Promise.resolve()),
  default: { sendMail: vi.fn(() => Promise.resolve()) },
}));

describe('Promo Controller — sendGigEmail', () => {
  let status = 0;
  let payload: any;
  const resStub: any = {
    status: (s: number) => { status = s; return { json: (obj: any) => { payload = obj; return obj; } }; },
  };
  const makeReq = (overrides: any = {}) => ({
    user: 'uid', get: () => 'localhost', protocol: 'http', body: { subject: 'Gig!', bodyHtml: '<p>come</p>' }, ...overrides,
  });

  beforeEach(() => { status = 0; payload = undefined; });

  it('403s a caller whose privileges lack promo:email', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ privileges: ['gig:create'] })) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(403);
    expect(payload.message).toContain('promo:email');
  });

  it('403s a roleless caller with no privileges', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'none', privileges: [] })) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(403);
    expect(payload.message).toContain('not authorized');
  });

  it('401s when the user is not found', async () => {
    userModel.findById = vi.fn(() => Promise.resolve(null)) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(401);
  });

  it('allows a bot with the promo:email capability', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'web-jam-llm', privileges: ['promo:email'] })) as any;
    subscriberModel.find = vi.fn(() => Promise.resolve([])) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(200);
    expect(payload).toEqual({ sent: 0, failed: 0, total: 0 });
  });

  it('allows a JaM-admin via role fallback (no privileges)', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'JaM-admin', privileges: [] })) as any;
    subscriberModel.find = vi.fn(() => Promise.resolve([])) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(200);
  });

  it('allows a Developer via role fallback', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'Developer' })) as any;
    subscriberModel.find = vi.fn(() => Promise.resolve([])) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(200);
  });

  it('400s when subject or bodyHtml is missing', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'Developer' })) as any;
    await (controller as any).sendGigEmail(makeReq({ body: { subject: 'x' } }), resStub);
    expect(status).toBe(400);
  });

  it('sends to every active email subscriber and reports the count', async () => {
    userModel.findById = vi.fn(() => Promise.resolve({ userType: 'Developer' })) as any;
    subscriberModel.find = vi.fn(() => Promise.resolve([
      { email: 'a@b.com', unsubscribeToken: 't1' },
      { email: 'c@d.com', unsubscribeToken: 't2' },
    ])) as any;
    await (controller as any).sendGigEmail(makeReq(), resStub);
    expect(status).toBe(200);
    expect(payload).toEqual({ sent: 2, failed: 0, total: 2 });
    expect((subscriberModel.find as any).mock.calls[0][0]).toEqual({ status: 'active', 'channels.email': true });
  });
});

import google, { type GoogleAuthenticateResponse } from '../../src/auth/google.js';

describe('google.ts', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('authenticates returns a 401 error', async () => {
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req)).rejects.toThrow(/Unauthorized|401/);
  });
  it('catches error on fetching a profile', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('boom')));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    const partialEmessage = new RegExp('Failed to receive google profile information');
    await expect(google.authenticate(req)).rejects.toThrow(partialEmessage);
  });
  it('returns error when profile is null', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'booya' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => null as unknown as GoogleAuthenticateResponse }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req)).rejects.toThrow('Failed to retrieve a proper user profile from Google');
  });
  it('authenticates using the redirectUri scheme as sent (no localhost rewrite)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'booya' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ emailAddresses: [{ value: 'me@me.com' }], names: [] }) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'https://localhost.com' } };
    const res = await google.authenticate(req);
    expect(res.emailAddresses[0].value).toBe('me@me.com');
  });
});

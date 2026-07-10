import google, { type GoogleAuthenticateResponse } from '#src/auth/google.js';

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
  it('#929 logs Google\'s status/error/error_description and clientId (never the secret) on exchange failure', async () => {
    const prevSecret = process.env.GoogleClientSecret;
    process.env.GoogleClientSecret = 'super-secret-value';
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'invalid_grant', error_description: 'Bad Request' }),
    }));
    const req = { body: { code: 'whatever', clientId: 'my-client-id', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req)).rejects.toThrow('400 Bad Request');
    expect(consoleErrorSpy).toHaveBeenCalledWith('[auth/google] token exchange failed', {
      status: 400,
      error: 'invalid_grant',
      error_description: 'Bad Request',
      clientId: 'my-client-id',
    });
    expect(JSON.stringify(consoleErrorSpy.mock.calls[0])).not.toContain('super-secret-value');
    consoleErrorSpy.mockRestore();
    process.env.GoogleClientSecret = prevSecret;
  });

  it("accepts Tim's OAuth client id (#885) and pairs it with Tim's secret", async () => {
    const prevId = process.env.TimGoogleClientId;
    const prevSecret = process.env.TimGoogleClientSecret;
    process.env.TimGoogleClientId = 'tim-client-id';
    process.env.TimGoogleClientSecret = 'tim-secret';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'booya' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ emailAddresses: [{ value: 'tim@me.com' }], names: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const req = { body: { code: 'whatever', clientId: 'tim-client-id', redirectUri: 'https://timshermanmusic.com' } };
    const res = await google.authenticate(req);
    expect(res.emailAddresses[0].value).toBe('tim@me.com');
    // the token-exchange POST body carries Tim's secret, not JaMmusic's
    expect((fetchMock.mock.calls[0][1] as { body: URLSearchParams }).body.get('client_secret')).toBe('tim-secret');
    process.env.TimGoogleClientId = prevId;
    process.env.TimGoogleClientSecret = prevSecret;
  });
});

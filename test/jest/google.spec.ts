/* eslint-disable @typescript-eslint/no-explicit-any */
import superagent from 'superagent';
import google from '../../src/auth/google';

describe('google.ts', () => {
  it('authenticates returns a 401 error', async () => {
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('Unauthorized');
  });
  it('catches error on fetching a profile', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({}) }) }) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    const partialEmessage = new RegExp('Failed to receive google profile information');
    await expect(google.authenticate(req))
      .rejects.toThrow(partialEmessage);
  });
  it('returns error when profile is null', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'booya' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve(null) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('Failed to retrieve a proper user profile from Google');
  });
  it('uses http to when localhost auth', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'booya' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve({ body: { emailAddresses: ['me@me.com'] } }) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'https://localhost.com' } };
    const res = await google.authenticate(req);
    expect(res.emailAddresses[0]).toBe('me@me.com');
  });
});

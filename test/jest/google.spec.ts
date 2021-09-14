/* eslint-disable @typescript-eslint/no-explicit-any */
import superagent from 'superagent';
import google from '../../src/auth/google';

describe('The Unit Test for Google Module', () => {
  it('authenticates returns a 401 error', async () => {
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('Unauthorized');
  });
  it('catches error on fetching a profile', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({}) }) }) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow("Cannot read properties of undefined (reading 'access_token')");
  });
  it('returns error when profile is null', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'booya' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve(null) }));
    const req = { body: { code: 'whatever', clientId: '123', redirectUri: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('failed to retrieve user profile from Google');
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

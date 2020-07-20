import superagent from 'superagent';
import google from '../../src/auth/google';

describe('The Unit Test for Google Module', () => {
  it('authenticates returns a 401 error', async () => {
    const req: any = { body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('Unauthorized');
  });
  it('catches error on fetching a profile', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({}) }) }) }));
    const req: any = { body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('Cannot read property \'access_token\' of undefined');
  });
  it('returns error when profile is null', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'booya' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve(null) }));
    const req: any = { body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } };
    await expect(google.authenticate(req))
      .rejects.toThrow('failed to retrieve user profile from Google');
  });
});

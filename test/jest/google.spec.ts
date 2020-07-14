const superagent = require('superagent');
const google = require('../../src/auth/google');

describe('The Unit Test for Google Module', () => {
  it('authenticates returns a 401 error', async () => {
    await expect(google.authenticate({ body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } }))
      .rejects.toThrow('Unauthorized');
  });
  it('catches error on fetching a profile', async () => {
    superagent.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({}) }) }) }));
    await expect(google.authenticate({ body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } }))
      .rejects.toThrow('Cannot read property \'access_token\' of undefined');
  });
  it('returns error when profile is null', async () => {
    superagent.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'booya' } }) }) }) }));
    superagent.get = jest.fn(() => ({ set: () => Promise.resolve(null) }));
    await expect(google.authenticate({ body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } }))
      .rejects.toThrow('failed to retrieve user profile from Google');
  });
});

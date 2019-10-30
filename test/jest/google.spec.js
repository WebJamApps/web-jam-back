const google = require('../../auth/google');

describe('The Unit Test for Google Module', () => {
  it('authenticates returns a 401 error', async () => {
    await expect(google.authenticate({ body: { code: 'whatever', clientId: '123', redirectUrl: 'http://whatever.com' } }))
      .rejects.toThrow('Unauthorized');
  });
  // eslint-disable-next-line jest/no-commented-out-tests
  // it('authenticates with existing google user', async () => {
  //   uMock = sinon.mock(User);
  //   uMock.expects('findOneAndUpdate').chain('exec').resolves({ _id: '4444' });
  //   // const sub = 'foo@example.com';
  //   const token = { access_token: 'access_token' };
  //   nock('https://accounts.google.com')
  //     .post('/o/oauth2/token')
  //     .reply(200, token);
  //   const profile = { names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] };
  //   nock('https://people.googleapis.com')
  //     .get('/v1/people/me?personFields=names%2CemailAddresses')
  //     .reply(200, profile);
  //   const req = { body: {} };
  //   const res = {
  //     status() {
  //       return {
  //         json(obj) {
  //           expect(obj.token.length).to.be.gt(20);
  //           uMock.restore();
  //         },
  //       };
  //     },
  //   };
  //   await google.authenticate(req, res);
  // });
// eslint-disable-next-line jest/no-commented-out-tests
//   it('should create a new user and authenticate', async () => {
//     uMock = sinon.mock(User);
//     uMock.expects('create').resolves({ _id: '123' });
//     // const sub = 'foo2@example.com';
//     const token = { access_token: 'access_token' };
//     nock('https://accounts.google.com')
//       .post('/o/oauth2/token')
//       .reply(200, token);
//     const profile = { names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] };
//     nock('https://people.googleapis.com')
//       .get('/v1/people/me?personFields=names%2CemailAddresses')
//       .reply(200, profile);
//     const req = { body: {} };
//     const res = {
//       status() {
//         return {
//           json(obj) {
//             expect(obj.token.length).to.be.gt(20);
//             // Make sure our token contains a new user id, different from existing userid
//             const payload = jwt.decode(obj.token, config.hashString);
//             expect(payload.sub).to.equal('123');
//             uMock.restore();
//           },
//         };
//       },
//     };
//     await google.authenticate(req, res);
//   });
// eslint-disable-next-line jest/no-commented-out-tests
//   it('returns google api error from post to get the token', async () => {
//     // const sub = 'foo2@example.com';
//     nock('https://accounts.google.com')
//       .post('/o/oauth2/token')
//       .replyWithError(500);
//     const profile = { names: [{ displayName: 'Josh' }], emailAddresses: [{ value: 'j@js.com' }] };
//     nock('https://people.googleapis.com')
//       .get('/v1/people/me?personFields=names%2CemailAddresses')
//       .reply(200, profile);
//     const req = { body: {} };
//     try {
//       await google.authenticate(req);
//     } catch (e) {
//       expect(e.message).to.equal('Error: 500');
//     }
//   });
// eslint-disable-next-line jest/no-commented-out-tests
//   it('returns google api error from get user profile', async () => {
//     const token = { access_token: 'access_token' };
//     nock.cleanAll();
//     nock('https://accounts.google.com')
//       .post('/o/oauth2/token')
//       .reply(200, token);
//     nock('https://people.googleapis.com')
//       .get('/v1/people/me?personFields=names%2CemailAddresses')
//       .replyWithError(500);
//     const req = { body: {} };
//     try {
//       await google.authenticate(req);
//     } catch (e) {
//       expect(e.message).to.equal('Error: 500');
//     }
//   });
// eslint-disable-next-line jest/no-commented-out-tests
//   it('returns google api error from get user profile when profile is null', async () => {
//     const token = { access_token: 'access_token' };
//     nock.cleanAll();
//     nock('https://accounts.google.com')
//       .post('/o/oauth2/token')
//       .reply(200, token);
//     nock('https://people.googleapis.com')
//       .get('/v1/people/me?personFields=names%2CemailAddresses')
//       .reply(200);
//     const req = { body: {} };
//     try {
//       await google.authenticate(req);
//     } catch (e) {
//       expect(e.message).to.equal('failed to retrieve user profile from Google');
//     }
//   });
});

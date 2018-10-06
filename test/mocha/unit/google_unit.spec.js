const EventEmitter = require('events');
const jwt = require('jwt-simple');
const nock = require('nock');
const sinon = require('sinon');
require('sinon-mongoose');
const google = require('../../../auth/google');
const User = require('../../../model/user/user-schema');
const config = require('../../../config');

describe('The Unit Test for Google Module', () => {
  before(async () => {
    await User.deleteMany({});
    EventEmitter.defaultMaxListeners = Infinity;
  });
  after(async () => {
    await User.deleteMany({});
    EventEmitter.defaultMaxListeners = 10;
  });
  it('authenticates with existing google user', async () => {
    uMock = sinon.mock(User);
    uMock.expects('findOneAndUpdate').chain('exec').resolves({ _id: '4444' });
    const sub = 'foo@example.com';
    const token = { access_token: 'access_token' };
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .reply(200, token);
    const profile = { email: sub, name: 'judy' };
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .reply(200, profile);
    const req = { body: {} };
    const res = {
      status() {
        return {
          json(obj) {
            expect(obj.token.length).to.be.gt(20);
            uMock.restore();
          }
        };
      }
    };
    await google.authenticate(req, res);
  });

  it('should create a new user and authenticate', async () => {
    uMock = sinon.mock(User);
    uMock.expects('create').resolves({ _id: '123' });
    const sub = 'foo2@example.com';
    const token = { access_token: 'access_token' };
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .reply(200, token);
    const profile = { email: sub, name: 'bob' };
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .reply(200, profile);
    const req = { body: {} };
    const res = {
      status() {
        return {
          json(obj) {
            expect(obj.token.length).to.be.gt(20);
            // Make sure our token contains a new user id, different from existing userid
            const payload = jwt.decode(obj.token, config.hashString);
            expect(payload.sub).to.equal('123');
            uMock.restore();
          }
        };
      }
    };
    await google.authenticate(req, res);
  });
  it('returns google api error from post to get the token', async () => {
    const sub = 'foo2@example.com';
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .replyWithError(500);
    const profile = { email: sub, name: 'bob' };
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .reply(200, profile);
    const req = { body: {} };
    try {
      await google.authenticate(req);
    } catch (e) {
      expect(e.message).to.equal('Error: 500');
    }
  });
  it('returns google api error from get user profile', async () => {
    const token = { access_token: 'access_token' };
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .reply(200, token);
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .replyWithError(500);
    const req = { body: {} };
    try {
      await google.authenticate(req);
    } catch (e) {
      expect(e.message).to.equal('Error: 500');
    }
  });
});

const google = require('../../auth/google');
const User = require('../../model/user/user-schema');
const jwt = require('jwt-simple');
const config = require('../../config');
const nock = require('nock');

describe('The Unit Test for Google Module', () => {
  let userid;

  before((done) => {
    // Set up an existing user
    mockgoose(mongoose).then(() => {
      const user = new User();
      user.name = 'foo';
      user.email = 'foo@example.com';
      user.save((err) => {
        userid = user._id.toString();
        done();
      });
    });
  });

  it('should authenticate with existing user', (done) => {
    const sub = 'foo@example.com';
    const token = { access_token: 'access_token' };
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .reply(200, token);

    const profile = { email: sub };
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .reply(200, profile);

    const req = { body: {} };
    const res = {
      send: (msg) => {
        expect(msg).to.have.property('token');
        const payload = jwt.decode(msg.token, config.hashString);
        expect(payload.sub).to.equal(userid);
        done();
      }
    };

    google.authenticate(req, res);
  });

  it('should create a new user and authenticate', (done) => {
    const sub = 'foo2@example.com';
    const token = { access_token: 'access_token' };
    nock('https://accounts.google.com')
      .post('/o/oauth2/token')
      .reply(200, token);

    const profile = { email: sub };
    nock('https://www.googleapis.com')
      .get('/plus/v1/people/me/openIdConnect')
      .reply(200, profile);

    const req = { body: {} };
    const res = {
      send: (msg) => {
        expect(msg).to.have.property('token');
        // Make sure our token contains a new user id, different from existing userid
        const payload = jwt.decode(msg.token, config.hashString);
        expect(payload.sub).to.not.equal(userid);
        done();
      }
    };

    google.authenticate(req, res);
  });
});

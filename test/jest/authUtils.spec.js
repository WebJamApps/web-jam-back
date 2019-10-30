const EventEmitter = require('events');
const jwt = require('jwt-simple');
const moment = require('moment');
const AuthUtils = require('../../auth/authUtils');
const config = require('../../config');

EventEmitter.defaultMaxListeners = Infinity;
describe('the authUtils', () => {
  it('validates email syntax', async () => {
    const cb = await AuthUtils.checkEmailSyntax({ body: { changeemail: 'j@jb.com' } });
    expect(cb).toBe(true);
  });
  it('validates email syntax and returns error', async () => {
    await expect(AuthUtils.checkEmailSyntax({ body: { changeemail: 'bogas' } })).rejects.toThrow('email address is not a valid format');
  });
  it('creates the token', () => {
    const user = { _id: 'someid' };
    const payload = AuthUtils.createJWT(user);
    expect(payload).toBeDefined();
    const decoded = jwt.decode(payload, config.hashString);
    expect(decoded.sub).toBe(user._id);
  });
  it('returns 401 without authorization', () => new Promise((done) => {
    const req = { headers: { authorization: false } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('Authorization')).toBe(true);
            done();
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res);
  }));
  it('returns 401 when jwt.decode fails', () => new Promise((done) => {
    const req = { headers: { authorization: 'this will fail jwt.decode' } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('Not enough or too many segments')).toBe(true);
            done();
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res);
  }));
  it('should 401 when exp <= moment().unix()', () => new Promise((done) => {
    const payload = { exp: moment().unix() };
    const auth = jwt.encode(payload, config.hashString);
    const req = { headers: { authorization: `Bearer ${auth}` } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('expired')).toBe(true);
            done();
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res);
  }));
});

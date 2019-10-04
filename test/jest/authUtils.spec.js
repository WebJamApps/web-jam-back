const EventEmitter = require('events');
const jwt = require('jwt-simple');
const moment = require('moment');
const sinon = require('sinon');
const AuthUtils = require('../../auth/authUtils');
const config = require('../../config');

EventEmitter.defaultMaxListeners = Infinity;
describe('the authUtils', () => {
  it('validates email syntax', async () => {
    const cb = await AuthUtils.checkEmailSyntax({ body: { changeemail: 'j@jb.com' } });
    expect(cb).toBe(true);
  });
  it('validates email syntax and returns error', async () => {
    try {
      await AuthUtils.checkEmailSyntax({ body: { changeemail: 'bogas' } });
    } catch (e) {
      expect(e.message).toBe('email address is not a valid format');
    }
  });
  it('creates the token', () => {
    const user = { _id: 'someid' };
    const payload = AuthUtils.createJWT(user);
    expect(payload).toBeDefined();
    const decoded = jwt.decode(payload, config.hashString);
    expect(decoded.sub).toBe(user._id);
  });
  it('should call res.send with err', () => {
    const err = 'err';
    const send = sinon.spy();
    const res = { send };
    AuthUtils.handleError(res, err);
    expect(send.args[0]).toEqual([400, err]);
  });
  it('returns 401 without authorization', (done) => {
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
  });
  it('returns 401 when jwt.decode fails', (done) => {
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
  });
  it('should 401 when exp <= moment().unix()', (done) => {
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
  });
  it('should call next when all is well', () => {
    const sub = 'test';
    const payload = {
      sub,
      exp: moment().add(14, 'days').unix(),
    };
    const auth = jwt.encode(payload, config.hashString);
    const req = { headers: { authorization: `Bearer ${auth}` } };
    const next = sinon.spy();
    AuthUtils.ensureAuthenticated(req, null, next);
    expect(req.user).toBe(sub);
    expect(next.called).toBe(true);
  });
});

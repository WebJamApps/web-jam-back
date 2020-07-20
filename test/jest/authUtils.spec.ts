import jwt from 'jwt-simple';
import moment from 'moment';
import AuthUtils from '../../src/auth/authUtils';
import config from '../../src/config';

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
    const decoded = jwt.decode(payload, config.hashString || '');
    expect(decoded.sub).toBe(user._id);
  });
  it('returns 401 without authorization', () => {
    const req = { headers: { authorization: false } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('Authorization')).toBe(true);
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res, jest.fn());
  });
  it('returns 401 when jwt.decode fails', () => {
    const req = { headers: { authorization: 'this will fail jwt.decode' } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('Not enough or too many segments')).toBe(true);
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res, jest.fn());
  });
  it('should 401 when exp <= moment().unix()', () => {
    const payload = { exp: moment().unix() };
    const auth = jwt.encode(payload, config.hashString || '');
    const req = { headers: { authorization: `Bearer ${auth}` } };
    const res = {
      status(num) {
        expect(num).toBe(401);
        return {
          send({ message }) {
            expect(message.includes('expired')).toBe(true);
          },
        };
      },
    };
    AuthUtils.ensureAuthenticated(req, res, jest.fn());
  });
});

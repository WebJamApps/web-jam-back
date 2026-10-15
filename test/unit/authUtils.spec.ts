import jwt from 'jwt-simple';
import mongoose from 'mongoose';
import AuthUtils, { type AuthRequest } from '#src/auth/authUtils.js';
import config from '#src/config.js';
import userModel from '#src/model/user/user-schema.js';

describe('the authUtils', () => {
  const reqStub = { user: '', userType: '', baseUrl: '' } as unknown as AuthRequest;
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
    // Browser login expires 24h after issue (web-jam-back#829).
    expect(decoded.exp - decoded.iat).toBe(24 * 60 * 60);
  });
  it('creates a service token without an exp claim', () => {
    const user = { _id: 'svc-id' };
    const token = AuthUtils.createServiceJWT(user);
    expect(token).toBeDefined();
    const decoded = jwt.decode(token, config.hashString || '');
    expect(decoded.sub).toBe(user._id);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeUndefined();
  });
  it('does not find the user by id', async () => {
    let eMessage = '';
    const uM = userModel as any; // Mocking Mongoose models often requires 'any' or complex type overrides
    uM.findById = vi.fn(() => ({ lean: () => ({ exec: () => Promise.reject(new Error('bad')) }) }));
    reqStub.user = new mongoose.Types.ObjectId().toHexString();
    reqStub.baseUrl = '/booya';
    try {
      await AuthUtils.findUserById(reqStub);
    } catch (err) { eMessage = (err as Error).message; }
    expect(eMessage.includes('token does not match')).toBe(true);
  });
  it('prevents user with incorrect userType', async () => {
    let eMessage = '';
    const uM = userModel as any;
    uM.findById = vi.fn(() => ({ lean: () => ({ exec: () => Promise.resolve() }) }));
    reqStub.user = new mongoose.Types.ObjectId().toHexString();
    reqStub.baseUrl = '/book';
    try {
      await AuthUtils.findUserById(reqStub);
    } catch (err) { eMessage = (err as Error).message; }
    expect(eMessage.includes('The user does not have the permission')).toBe(true);
  });
  it('extracts canonical token from various authorization header formats (#1160)', () => {
    expect(AuthUtils.extractToken({ headers: { authorization: 'Bearer jwt.token.here' } })).toBe('jwt.token.here');
    expect(AuthUtils.extractToken({ headers: { authorization: 'Anything1 jwt.token.here' } })).toBe('jwt.token.here');
    expect(AuthUtils.extractToken({ headers: { authorization: 'jwt.token.here' } })).toBe('jwt.token.here');
    expect(AuthUtils.extractToken({ headers: { Authorization: 'Bearer cap.jwt.token' } })).toBe('cap.jwt.token');
    expect(AuthUtils.extractToken({ headers: { authorization: ['Bearer array.token'] } })).toBe('array.token');
    expect(AuthUtils.extractToken({ headers: {} })).toBe('');
    expect(AuthUtils.extractToken({ headers: { authorization: '' } })).toBe('');
  });
  it('extracts sub claim from valid token across various authorization header formats (#1160)', () => {
    const user = { _id: 'test-user-sub-123' };
    const token = AuthUtils.createJWT(user);
    expect(AuthUtils.extractSub({ headers: { authorization: `Bearer ${token}` } })).toBe('test-user-sub-123');
    expect(AuthUtils.extractSub({ headers: { authorization: `Anything1 ${token}` } })).toBe('test-user-sub-123');
    expect(AuthUtils.extractSub({ headers: { authorization: token } })).toBe('test-user-sub-123');
    expect(AuthUtils.extractSub({ headers: { Authorization: `Bearer ${token}` } })).toBe('test-user-sub-123');
    expect(AuthUtils.extractSub({ headers: { authorization: [`Bearer ${token}`] } })).toBe('test-user-sub-123');
    expect(AuthUtils.extractSub({ headers: {} })).toBe('');
    expect(AuthUtils.extractSub({ headers: { authorization: '' } })).toBe('');
    expect(AuthUtils.extractSub({ headers: { authorization: 'invalid.jwt.token' } })).toBe('');
  });
});

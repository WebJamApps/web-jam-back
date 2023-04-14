import jwt from 'jwt-simple';
import moment from 'moment';
import mongoose from 'mongoose';
import AuthUtils from '../../src/auth/authUtils';
import config from '../../src/config';
import userModel from '../../src/model/user/user-schema';

describe('the authUtils', () => {
  const reqStub:any = { user: '' };
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
  it('does not find the user by id', async () => {
    let eMessage = '';
    const uM:any = userModel;
    uM.findById = jest.fn(() => ({ lean: () => ({ exec: () => Promise.reject(new Error('bad')) }) }));
    reqStub.user = new mongoose.Types.ObjectId();
    reqStub.baseUrl = '/booya';
    try {
      await AuthUtils.findUserById(reqStub);
    } catch (err) { eMessage = (err as Error).message; }
    expect(eMessage.includes('token does not match')).toBe(true);
  });  
  it('prevents user with incorrect userType', async () => {
    let eMessage = '';
    const uM:any = userModel;
    uM.findById = jest.fn(() => ({ lean: () => ({ exec: () => Promise.resolve() }) }));
    reqStub.user = new mongoose.Types.ObjectId();
    reqStub.baseUrl = '/book';
    try {
      await AuthUtils.findUserById(reqStub);
    } catch (err) { eMessage = (err as Error).message; }
    expect(eMessage.includes('The user does not have the permission')).toBe(true);
  });
});

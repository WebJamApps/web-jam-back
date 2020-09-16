/* eslint-disable @typescript-eslint/no-explicit-any */
import superagent from 'superagent';
import controller from '../../../src/model/user/user-controller';

describe('User Controller', () => {
  let r:any;
  const resStub:any = {
    status: () => ({ json: (obj: any) => Promise.resolve(obj) }),
  };
  const reqStub:any = { body: { email: '' } };
  it('catches error on findByEmail', async () => {
    controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.findByEmail(reqStub, resStub);
    expect(r.message).toBe('bad');
  });
  it('returns 400 on findByEmail', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve());
    r = await controller.findByEmail(reqStub, resStub);
    expect(r.message).toBe('wrong email');
  });
  // it('returns 400 on pswdreset', async () => {
  //   r = await controller.pswdreset({ body: { email: '' } }, resStub);
  //   expect(r.message).toBe('Password is not min 8 characters');
  // });
  // it('returns 400 on pswdreset with weak password', async () => {
  //   r = await controller.pswdreset({ body: { password: 'weak', email: '' } }, resStub);
  //   expect(r.message).toBe('Password is not min 8 characters');
  // });
  // it('returns 500 on pswdreset with failure to encrypt', async () => {
  //   controller.model.encryptPswd = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.pswdreset({ body: { password: 'weak123456789', email: '' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('returns 200 on pswdreset', async () => {
  //   controller.model.encryptPswd = jest.fn(() => Promise.resolve('encryptedpasswordhere'));
  //   controller.authFindOneAndUpdate = jest.fn(() => Promise.resolve(true));
  //   r = await controller.pswdreset({ body: { password: 'weak123456789', email: '' } }, resStub);
  //   expect(r).toBe(true);
  // });
  // it('returns 500 on resetpswd', async () => {
  //   controller.model.findOneAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.resetpswd({ body: { password: 'weak123456789', email: '' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('catches error on findOne when validateChangeEmail', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
  //   await expect(controller.validateChangeEmail({ body: { changeemail: '' } })).rejects.toThrow('bad');
  // });
  // it('catches error on validateChangeEmail when changeemail', async () => {
  //   controller.validateChangeEmail = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.changeemail({ body: { changeemail: 'j@b.com' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('catches error on findOneAndUpdate when changeemail', async () => {
  //   controller.validateChangeEmail = jest.fn(() => Promise.resolve(true));
  //   controller.model.findOneAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.changeemail({ body: { changeemail: 'j@b.com' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  it('return 401 on finishLogin', async () => {
    r = await controller.finishLogin(resStub, false, {});
    expect(r.message).toBe('Wrong password');
  });
  it('return 500 on finishLogin', async () => {
    controller.model.findByIdAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.finishLogin(resStub, true, {});
    expect(r.message).toBe('bad');
  });
  it('return 400 on login', async () => {
    r = await controller.login({ body: {} }, resStub);
    expect(r.message).toBe('email and password are required');
  });
  it('catches error on login', async () => {
    controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
    expect(r.message).toBe('bad');
  });
  it('returns 401 wrong email on login', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve(null));
    r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
    expect(r.message).toBe('Wrong email address');
  });
  it('returns 401 reset password on login', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: '' }));
    r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
    expect(r.message).toBe('Please reset your password');
  });
  it('returns 401 verify email on login', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: 'pw', verifiedEmail: false }));
    r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
    expect(r.message).toBe('<a href="/userutil">Verify</a> your email');
  });
  it('catches error from comparePassword during login', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: 'pw', verifiedEmail: true }));
    controller.model.comparePassword = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
    expect(r.message).toBe('bad');
  });
  it('catches error from finish signup', async () => {
    controller.model.create = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.finishSignup(resStub, {}, 1);
    expect(r.message).toBe('bad');
  });
  it('returns 400 from signup', async () => {
    controller.model.validateSignup = jest.fn(() => 'invalid');
    r = await controller.signup({ body: {} }, resStub);
    expect(r.message).toBe('invalid');
  });
  it('catches findOne error from signup', async () => {
    controller.model.validateSignup = jest.fn(() => '');
    controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.signup({ body: {} }, resStub);
    expect(r.message).toBe('bad');
  });
  it('returns 409 error from signup', async () => {
    controller.model.validateSignup = jest.fn(() => '');
    controller.model.findOne = jest.fn(() => Promise.resolve({ verifiedEmail: true }));
    r = await controller.signup({ body: {} }, resStub);
    expect(r.message).toBe('This email address is already registered');
  });
  it('returns 500 error from findByIdAndRemove during signup', async () => {
    controller.model.validateSignup = jest.fn(() => '');
    controller.model.findOne = jest.fn(() => Promise.resolve({ verifiedEmail: false }));
    controller.model.findByIdAndRemove = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.signup({ body: {} }, resStub);
    expect(r.message).toBe('bad');
  });
  it('catches error on google authenticate', async () => {
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.reject(new Error('bad')) }) }) }));
    r = await controller.google({ body: {} }, resStub);
    expect(r.message).toBe('bad');
  });
  it('catches error on findOneAndUpdate when google authenticate', async () => {
    controller.model.findOneAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'token' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve({ body: { names: [{ displayName: 'justin' }], emailAddresses: ['j@b.com'] } }) }));
    r = await controller.google({ body: {} }, resStub);
    expect(r.message).toBe('bad');
  });
  it('successfully google authenticate', async () => {
    controller.model.findOneAndUpdate = jest.fn(() => Promise.resolve({}));
    const sa: any = superagent;
    sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'token' } }) }) }) }));
    sa.get = jest.fn(() => ({ set: () => Promise.resolve({ body: { names: [{ displayName: 'justin' }], emailAddresses: ['j@b.com'] } }) }));
    r = await controller.google({ body: {} }, resStub);
    expect(r.token).toBeDefined();
  });
});

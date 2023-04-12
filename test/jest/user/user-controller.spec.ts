/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
import superagent from 'superagent';
import controller from '../../../src/model/user/user-controller';

describe('User Controller', () => {
  let r:any, testObj:any;
  const resStub:any = {
    status: () => ({ json: (obj: any) => { testObj = obj; } }),
  };
  const reqStub:any = { body: { email: '' } };
  // it('catches error on findByEmail', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.findByEmail(reqStub, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('returns 400 on findByEmail', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve());
  //   r = await controller.findByEmail(reqStub, resStub);
  //   expect(r.message).toBe('wrong email');
  // });
  // it('return 401 on finishLogin', async () => {
  //   r = await controller.finishLogin(resStub, false, {});
  //   expect(r.message).toBe('Wrong password');
  // });
  // it('return 500 on finishLogin', async () => {
  //   controller.model.findByIdAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.finishLogin(resStub, true, {});
  //   expect(r.message).toBe('bad');
  // });
  // it('return 400 on login', async () => {
  //   r = await controller.login({ body: {} }, resStub);
  //   expect(r.message).toBe('email and password are required');
  // });
  // it('catches error on login', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('returns 401 wrong email on login', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve(null));
  //   r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
  //   expect(r.message).toBe('Wrong email address');
  // });
  // it('returns 401 reset password on login', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: '' }));
  //   r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
  //   expect(r.message).toBe('Please reset your password');
  // });
  // it('returns 401 verify email on login', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: 'pw', verifiedEmail: false }));
  //   r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
  //   expect(r.message).toBe('<a href="/userutil">Verify</a> your email');
  // });
  // it('catches error from comparePassword during login', async () => {
  //   controller.model.findOne = jest.fn(() => Promise.resolve({ _id: '123', password: 'pw', verifiedEmail: true }));
  //   controller.model.comparePassword = jest.fn(() => Promise.reject(new Error('bad')));
  //   r = await controller.login({ body: { email: 'j@b.com', password: 'pw' } }, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('catches error on google authenticate', async () => {
  //   const sa: any = superagent;
  //   sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.reject(new Error('bad')) }) }) }));
  //   r = await controller.google({ body: {} } as any, resStub);
  //   expect(r.message).toBe('bad');
  // });
  // it('catches error on findOneAndUpdate when google authenticate', async () => {
  //   controller.model.findOneAndUpdate = jest.fn(() => Promise.reject(new Error('bad')));
  //   const sa: any = superagent;
  //   sa.post = jest.fn(() => ({ type: () => ({ send: () => ({ set: () => Promise.resolve({ body: { access_token: 'token' } }) }) }) }));
  //   sa.get = jest.fn(() => ({ set: () => Promise.resolve({ body: { names: [{ displayName: 'justin' }], emailAddresses: ['j@b.com'] } }) }));
  //   r = await controller.google({ body: {} } as any, resStub);
  //   expect(r.message).toBe('bad');
  // });
  it('successfully google authenticate', async () => {
    controller.model.findOneAndUpdate = jest.fn(() => Promise.resolve({}));
    const authMock:any = jest.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    controller.authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(testObj.token).toBeDefined();
    testObj = {};
  });
  it('successfully google authenticate when new user', async () => {
    controller.handleNewUser = jest.fn();
    controller.model.findOneAndUpdate = jest.fn(() => Promise.resolve(null));
    const authMock:any = jest.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    controller.authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(controller.handleNewUser).toHaveBeenCalled();
  });
});

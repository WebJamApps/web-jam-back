/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
import controller from 'src/model/user/user-controller';
import LibController from 'src/lib/controller';
import authGoogle from 'src/auth/google';

describe('User Controller', () => {
  let status = 0,
    testObj:any;
  const resStub:any = {
    status: (s:number) => { status = s; return ({ json: (obj: any) => { testObj = obj; } }); },
  };
  const reqStub:any = { body: { email: '' } };
  it('catches error on findByEmail', async () => {
    controller.resErr = jest.fn();
    (controller as unknown as LibController).model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
    await controller.findByEmail(reqStub, resStub);
    expect(controller.resErr).toHaveBeenCalled();
  });
  it('returns 200 on findByEmail', async () => {
    (controller as unknown as LibController).model.findOne = jest.fn(() => Promise.resolve({ _id: 'id' }));
    await controller.findByEmail(reqStub, resStub);
    expect(testObj._id).toBe('id');
  });
  it('successfully google authenticate', async () => {
    (controller as unknown as LibController).model.findOneAndUpdate = jest.fn(() => Promise.resolve({}));
    const authMock:any = jest.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(testObj.token).toBeDefined();
    testObj = {};
  });
  it('successfully google authenticate when new user', async () => {
    (controller as unknown as LibController).model.create = jest.fn(() => Promise.resolve({ password: 'password' }));
    (controller as unknown as LibController).model.findOneAndUpdate = jest.fn(() => Promise.resolve(null));
    const authMock:any = jest.fn(() => Promise.resolve({ names: [{ displayName: 'tester' }], emailAddresses: [{ value: 't@s.com' }] }));
    authGoogle.authenticate = authMock;
    await controller.google({ body: {} } as any, resStub);
    expect(status).toBe(201);
  }); 
});

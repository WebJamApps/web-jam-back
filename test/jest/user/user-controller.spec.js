const controller = require('../../../model/user/user-controller');

describe('User Controller', () => {
  let r;
  const resStub = {
    status: () => ({ json: (obj) => Promise.resolve(obj) }),
  };
  it('catches error on findByEmail', async () => {
    controller.model.findOne = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.findByEmail({ body: { email: '' } }, resStub);
    expect(r.message).toBe('bad');
  });
  it('returns 400 on findByEmail', async () => {
    controller.model.findOne = jest.fn(() => Promise.resolve());
    r = await controller.findByEmail({ body: { email: '' } }, resStub);
    expect(r.message).toBe('wrong email');
  });
  it('returns 400 on pswdreset', async () => {
    r = await controller.pswdreset({ body: { email: '' } }, resStub);
    expect(r.message).toBe('Password is not min 8 characters');
  });
  it('returns 400 on pswdreset with weak password', async () => {
    r = await controller.pswdreset({ body: { password: 'weak', email: '' } }, resStub);
    expect(r.message).toBe('Password is not min 8 characters');
  });
  it('returns 500 on pswdreset with failure to encrypt', async () => {
    controller.model.encryptPswd = jest.fn(() => Promise.reject(new Error('bad')));
    r = await controller.pswdreset({ body: { password: 'weak123456789', email: '' } }, resStub);
    expect(r.message).toBe('bad');
  });
  it('returns 200 on pswdreset', async () => {
    controller.model.encryptPswd = jest.fn(() => Promise.resolve('encryptedpasswordhere'));
    controller.authFindOneAndUpdate = jest.fn(() => Promise.resolve(true));
    r = await controller.pswdreset({ body: { password: 'weak123456789', email: '' } }, resStub);
    expect(r).toBe(true);
  });
});

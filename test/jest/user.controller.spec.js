const uc = require('../../model/user/user-controller');

describe('User Controller', () => {
  it('validates email', async () => {
    uc.model = { findOneAndUpdate() { return Promise.resolve({ name:'tester' }); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body:{ email:'yo@yo.com', resetCode:'1234' } }, res);
    expect(cb.name).toBe('tester');
  });
  it('catches error on validates email', async () => {
    uc.model = { findOneAndUpdate() { return Promise.reject(new Error('bad')); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body:{ email:'yo@yo.com', resetCode:'1234' } }, res);
    expect(cb.message).toBe('bad');
  });
  it('returns error on validates email when user is not found', async () => {
    uc.model = { findOneAndUpdate() { return Promise.resolve(null); } };
    const res = { status(code) { return { json(obj) { return obj; } }; } };
    const cb = await uc.validateEmail({ body:{ email:'yo@yo.com', resetCode:'1234' } }, res);
    expect(cb.message).toBe('incorrect email or code');
  });
});

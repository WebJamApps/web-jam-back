const uc = require('../../model/user/user-controller');

describe('Auth Controller', () => {
  it('validates email', async () => {
    uc.model = { findOne() { return { name:'tester', save() {} }; } };
    const res = { status(code) { return Promise.resolve(code); } };
    const cb = await uc.validateEmail({ body:{ email:'yo@yo.com', resetCode:'1234' } }, res);
    console.log(cb);
  });
});

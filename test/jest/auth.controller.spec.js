const ac = require('../../auth/auth.controller');

describe('Auth Controller', () => {
  it('validates email', (done) => {
    ac.validemail({ body:{ email:'yo@yo.com', resetCode:'1234' } }, {});
    // expect(jwt.decode(payload, config.hashString).sub).to.equal(user._id);
    done();
  });
});

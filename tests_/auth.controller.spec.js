const ac = require('../auth/auth.controller');

describe('Auth Controller', () => {
  it('validates email', (done) => {
    ac.validate(req, res);
    expect(jwt.decode(payload, config.hashString).sub).to.equal(user._id);
    done();
  });
});

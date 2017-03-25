const sinon = require('sinon');
const rewire = require('rewire');
const authUtils = rewire('../../auth/authUtils');
const moment = require('moment');

describe('The Unit Test for authUtils Module', () => {
  let jwt, revert_jwt;

  beforeEach(() => {
    jwt = { encode: sinon.stub(), decode: sinon.stub() };
    revert_jwt = authUtils.__set__('jwt', jwt);
  });

  afterEach(() => {
    revert_jwt();
  });

  describe('createJWT', () => {
    it('should create token', () => {
      const token = 'sometoken';
      const user = { _id: 'someid' };
      jwt.encode.returns(token)

      expect(authUtils.createJWT(user)).to.not.be.null;
      expect(jwt.encode.args[0][0].sub).to.equal(user._id);
    });
  });

  describe('handleError', () => {
    it('should call res.send with err', () => {
      const err = 'err';
      const send = sinon.spy();
      const res = { send };
      authUtils.handleError(res, err);
      expect(send.args[0]).to.deep.equal([400, err])
    });
  });

  describe('ensureAuthenticated', () => {
    it('should 401 without authorization', (done) => {
      const req = { headers: { authorization: false } };
      const res = {
        status(num) {
          expect(num).to.equal(401);
          return {
            send({ message }) {
              expect(message).to.have.string('Authorization');
              done();
            }
          };
        }
      };
      authUtils.ensureAuthenticated(req, res);
    });
    it('should 401 when jwt.decode fails', (done) => {
      revert_jwt();
      const req = { headers: { authorization: 'this will fail jwt.decode' } };
      const res = {
        status(num) {
          expect(num).to.equal(401);
          return {
            send({ message }) {
              expect(message).to.have.string('Not enough or too many segments');
              done();
            }
          };
        }
      };
      authUtils.ensureAuthenticated(req, res);
    });

    it('should 401 when exp <= moment().unix()', (done) => {
      jwt.decode.returns({ exp: moment().unix() });
      const req = { headers: { authorization: 'this shouldnt matter' } };
      const res = {
        status(num) {
          expect(num).to.equal(401);
          return {
            send({ message }) {
              expect(message).to.have.string('Token has expired');
              done();
            }
          };
        }
      };
      authUtils.ensureAuthenticated(req, res);
    });

    it('should call next when all is well', () => {
      const sub = 'test';
      jwt.decode.returns({ sub, exp: 1000 + moment().unix() });
      const req = { headers: { authorization: 'this shouldnt matter' } };
      const next = sinon.spy();
      authUtils.ensureAuthenticated(req, null, next);
      expect(req.user).to.equal(sub);
      expect(next.called).to.be.true;
    });
  });

});

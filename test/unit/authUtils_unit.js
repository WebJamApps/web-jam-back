const sinon = require('sinon');
const authUtils = require('../../auth/authUtils');
const jwt = require('jwt-simple');
const config = require('../../config');
const moment = require('moment');

describe('The Unit Test for authUtils Module', () => {

  describe('createJWT', () => {
    it('should create token', () => {
      const user = { _id: 'someid' };
      const payload = authUtils.createJWT(user);
      expect(payload).to.not.be.null; // eslint-disable-line no-unused-expressions
      expect(jwt.decode(payload, config.hashString).sub).to.equal(user._id);
    });
  });

  describe('handleError', () => {
    it('should call res.send with err', () => {
      const err = 'err';
      const send = sinon.spy();
      const res = { send };
      authUtils.handleError(res, err);
      expect(send.args[0]).to.deep.equal([400, err]);
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
      const payload = {
          exp: moment().unix()
      };
      const auth = jwt.encode(payload, config.hashString);
      const req = { headers: { authorization: 'Bearer ' + auth } };
      const res = {
        status(num) {
          expect(num).to.equal(401);
          return {
            send({ message }) {
              expect(message).to.have.string('expired');
              done();
            }
          };
        }
      };
      authUtils.ensureAuthenticated(req, res);
    });

    it('should call next when all is well', () => {
      const sub = 'test';
      const payload = {
          sub,
          exp: moment().add(14, 'days').unix()
      };
      const auth = jwt.encode(payload, config.hashString);
      const req = { headers: { authorization: 'Bearer ' + auth } };
      const next = sinon.spy();
      authUtils.ensureAuthenticated(req, null, next);
      expect(req.user).to.equal(sub);
      expect(next.called).to.be.true; // eslint-disable-line no-unused-expressions
    });
  });

});

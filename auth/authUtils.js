
const moment = require('moment');
// let is needed for rewire :(
let jwt = require('jwt-simple');  // eslint-disable-line prefer-const
const config = require('../config');

exports.createJWT = function(user) {
    const payload = {
        sub: user._id,
        iat: moment().unix(),
        exp: moment().add(14, 'days').unix()
    };
    return jwt.encode(payload, config.hashString);
};

exports.handleError = function(res, err) {
    return res.send(400, err);
};


exports.ensureAuthenticated = function(req, res, next) {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'Please make sure your request has an Authorization header' });
  }
  const token = req.headers.authorization.split(' ')[1];

  let payload = null;
  try {
    payload = jwt.decode(token, process.env.HashString);
  } catch (err) {
    return res.status(401).send({ message: err.message });
  }

  if (payload.exp <= moment().unix()) {
    return res.status(401).send({ message: 'Token has expired' });
  }
  req.user = payload.sub;
  next();
};

const moment = require('moment');
const jwt = require('jwt-simple');
const sgMail = require('@sendgrid/mail');
const config = require('../config');

class AuthUtils {
  static createJWT(user) {
    const payload = {
      sub: user._id,
      iat: moment().unix(),
      exp: moment().add(14, 'days').unix()
    };
    return jwt.encode(payload, config.hashString);
  }

  static handleError(res, err) {
    return res.send(400, err);
  }

  static ensureAuthenticated(req, res, next) {
    if (!req.headers.authorization) {
      return res.status(401).send({ message: 'Please make sure your request has an Authorization header' });
    }
    const token = req.headers.authorization.split(' ')[1];
    let payload = null;
    try {
      payload = jwt.decode(token, config.hashString);
    } catch (err) {
      return res.status(401).send({ message: err.message });
    }
    req.user = payload.sub;
    return next();
  }

  static sendGridEmail(bodyhtml, toemail, subjectline) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: toemail,
      from: 'user-service@web-jam.com',
      subject: subjectline,
      text: bodyhtml,
      html: bodyhtml
    };
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'test') sgMail.send(msg);
  }

  static generateCode(hi, low) {
    const min = Math.ceil(low);
    const max = Math.floor(hi);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  static saveSendToken(user, req, res) {
    const userToken = { token: this.createJWT(user), email: user.email };
    user.isPswdReset = false; // eslint-disable-line no-param-reassign
    user.resetCode = ''; // eslint-disable-line no-param-reassign
    user.changeemail = ''; // eslint-disable-line no-param-reassign
    user.save((err) => {
      if (err) return res.status(500).json({ message: err.message });
      return res.status(200).json(userToken);
    });
  }

  static checkEmailSyntax(req) {
    if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
      return Promise.resolve(true);
    }
    return Promise.reject(new Error('email address is not a valid format'));
  }

  static setIfExists(item) {
    if (item !== '' && item !== null && item !== undefined) {
      return item;
    }
    return '';
  }
}

module.exports = AuthUtils;

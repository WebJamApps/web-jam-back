const moment = require('moment');
const jwt = require('jwt-simple');
const config = require('../config');
const sgMail = require('@sendgrid/mail');

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
    next();
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
    if (process.env.NODE_ENV !== 'test') {
      sgMail.send(msg);
    }
  }

  static generateCode(hi, low) {
    const min = Math.ceil(low);
    const max = Math.floor(hi);
    return Math.floor(Math.random() * (max - min)) + min;
  }

  // static verifySaveUser(user, req, res) {
  //   // let hascode = false;
  //   // let hasnewemail = false;
  //   // if (user.resetCode !== '' && user.resetCode !== null && user.resetCode !== undefined) {
  //   //   hascode = true;
  //   // }
  //   // if (user.changeemail !== null && user.changeemail !== '' && user.changeemail !== undefined) {
  //   //   hasnewemail = true;
  //   // }
  //   // this checks if it is a brand new email that has not yet been verified
  //   // if (hascode && !user.isPswdReset && !hasnewemail) {
  //   //   return res.status(401).json({ message: 'Validate your email address or click forgot password link to reset' });
  //   // }
  //   user.comparePassword(req.body.password, (err, isMatch) => {
  //     if (!isMatch) { return res.status(401).json({ message: 'Wrong password' }); }
  //     this.saveSendToken(user, req, res);
  //   });
  // }

  static saveSendToken(user, req, res) {
    const userToken = { token: this.createJWT(user), email: user.email };
    user.isPswdReset = false;
    user.resetCode = '';
    user.changeemail = '';
    user.save(err =>
      res.status(200).json(userToken));
    }

    static checkEmailSyntax(req, res) {
      if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(req.body.changeemail)) {
        return console.log('email is valid');
      }
      return res.status(409).json({ message: 'Email address is not a valid format' });
    }

    static setIfExists(item) {
      if (item !== '' && item !== null && item !== undefined) {
        return item;
      }
      return '';
    }
  }

  module.exports = AuthUtils;

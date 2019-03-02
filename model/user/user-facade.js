const bcrypt = require('bcryptjs');
const Model = require('../../lib/facade');
const userSchema = require('./user-schema');

class UserModel extends Model {
  validateSignup(obj) { // eslint-disable-line class-methods-use-this
    let message = '';
    if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(obj.email)) {
      // the email is valid
    } else {
      message = 'Email address is invalid format';
    }
    if (obj.password.length < 8) {
      message = 'Password is not min 8 characters';
    }
    if (obj.name === '' || obj.name === null || obj.name === undefined) {
      message = 'User Name is missing';
    }
    return message;
  }

  comparePassword(password, userP) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => {
      bcrypt.compare(password, userP, (err, isMatch) => {
        if (err) return reject(err);
        if (!isMatch) return resolve(false);
        return resolve(true);
      });
    });
  }

  encryptPswd(password) { // eslint-disable-line class-methods-use-this
    return new Promise((resolve, reject) => bcrypt.genSalt(10, (err, salt) => {
      if (err) return reject(err);
      return bcrypt.hash(password, salt, (err2, hash) => {
        if (err2) return reject(err2);
        return resolve(hash);
      });
    }));
  }
}
module.exports = new UserModel(userSchema);

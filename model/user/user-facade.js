const bcrypt = require('bcryptjs');
const Model = require('../../lib/facade');
const userSchema = require('./user-schema');

class UserModel extends Model {
  validateSignup(obj) { // eslint-disable-line class-methods-use-this
    let message = '';
    if (/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(obj.email)) { // eslint-disable-line security/detect-unsafe-regex
      // the email is valid
    } else {
      message = 'Email address is invalid format';
    }
    if (!obj.password || obj.password.length < 8) {
      message = 'Password is not min 8 characters';
    }
    if (obj.name === '' || obj.name === null || obj.name === undefined) {
      message = 'User Name is missing';
    }
    return message;
  }

  async comparePassword(password, userP) { // eslint-disable-line class-methods-use-this
    let isMatch;
    try { isMatch = await bcrypt.compare(password, userP); } catch (e) { return Promise.reject(e); }
    return Promise.resolve(isMatch);
  }

  async encryptPswd(password) { // eslint-disable-line class-methods-use-this
    let salt, hash;
    try {
      salt = await bcrypt.genSalt(10);
      hash = await bcrypt.hash(password, salt);
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(hash);
  }
}
module.exports = new UserModel(userSchema);

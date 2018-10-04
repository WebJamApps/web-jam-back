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
}

module.exports = new UserModel(userSchema);

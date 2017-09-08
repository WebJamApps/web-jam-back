const Model = require('../../lib/facade');
const signupSchema  = require('./signup-schema');


class SignupModel extends Model {}

module.exports = new SignupModel(signupSchema);

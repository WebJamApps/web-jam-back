const Model = require('../../lib/facade');
const charitySchema = require('./charity-schema');


class CharityModel extends Model {

}

module.exports = new CharityModel(charitySchema);

const Controller = require('../../lib/controller');
const charityModel  = require('./charity-facade');

class CharityController extends Controller {

}

module.exports = new CharityController(charityModel);

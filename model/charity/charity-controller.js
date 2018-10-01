const Controller = require('../../lib/controller');
const charityModel = require('./charity-facade');

class CharityController extends Controller {
  find(req, res, next) {
    // console.log('this is the user id: ' + req.params.id);
    return this.model.find({ charityMngIds: req.params.id })
      .then(collection => res.status(200).json(collection));
  }
}

module.exports = new CharityController(charityModel);

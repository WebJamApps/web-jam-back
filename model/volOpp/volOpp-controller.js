const Controller = require('../../lib/controller');
const volOppModel  = require('./volOpp-facade');

class VolOppController extends Controller {
  find(req, res, next) {
    console.log('this is the charity id: ' + req.params.id);
    return this.model.find({ voCharityId:req.params.id })
    .then((collection) => {
      console.log(collection.length);
      return res.status(200).json(collection);
    });
  }
}

module.exports = new VolOppController(volOppModel);

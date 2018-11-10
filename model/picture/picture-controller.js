const Controller = require('../../lib/controller');
const pictureModel = require('./picture-facade');

class PictureController extends Controller {

}

module.exports = new PictureController(pictureModel);

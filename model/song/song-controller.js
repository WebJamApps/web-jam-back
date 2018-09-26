const Controller = require('../../lib/controller');
const songModel = require('./song-facade');

class SongController extends Controller {

}

module.exports = new SongController(songModel);

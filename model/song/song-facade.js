const Model = require('../../lib/facade');
const songSchema = require('./song-schema');


class SongModel extends Model {

}

module.exports = new SongModel(songSchema);

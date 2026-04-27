import Controller from '../../lib/controller.js';
import songModel from './song-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

class SongController extends Controller {

}

export default new SongController(songModel) as unknown as Icontroller;

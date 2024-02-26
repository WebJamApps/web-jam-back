import Controller from '../../lib/controller';
import songModel from './song-facade';
import { Icontroller } from '../../lib/routeUtils';

class SongController extends Controller {

}

export default new SongController(songModel) as unknown as Icontroller;

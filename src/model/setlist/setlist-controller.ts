import Controller from '../../lib/controller.js';
import setlistModel from './setlist-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

class SetlistController extends Controller {

}

export default new SetlistController(setlistModel) as unknown as Icontroller;

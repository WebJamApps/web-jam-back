import Controller from '../../lib/controller.js';
import gigModel from './gig-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

class GigController extends Controller {

}

export default new GigController(gigModel) as unknown as Icontroller;

import ArtistController from '../../lib/artist-controller.js';
import gigModel from './gig-facade.js';
import { Icontroller } from '../../lib/routeUtils.js';

// Gigs are shared across artists (#885): reads scope by ?artist=, writes stamp
// the artist and respect artist-scoped admins.
class GigController extends ArtistController {

}

export default new GigController(gigModel) as unknown as Icontroller;

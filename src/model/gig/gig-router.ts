import express from 'express';
import controller from './gig-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

// GET /gig is public (gigs are public data — same as the website + the
// unauthenticated WebJamSocketCluster `allGigs` channel). setRoot's GET handler
// runs without ensureAuthenticated; POST/DELETE stay authenticated.
routeUtils.setRoot(router, controller, authUtils);
routeUtils.byId(router, controller, authUtils);

export default router;

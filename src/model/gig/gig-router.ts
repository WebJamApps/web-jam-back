import express from 'express';
import controller from './gig-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

// GET /gig is public (gigs are public data — same as the website + the
// unauthenticated WebJamSocketCluster `allGigs` channel). setRoot's GET handler
// runs without ensureAuthenticated; POST/DELETE stay authenticated.
routeUtils.setRoot(router, controller, authUtils);

// GET /gig/promo-default.jpg is public, no auth (#962): it's the fallback
// promo image for POST /gig/:id/announce, and Meta's Graph API must be able
// to fetch it directly over plain HTTP(S) — the same "gigs are public"
// rationale as GET /gig itself. Registered BEFORE byId's `/:id` below so this
// literal path isn't swallowed by the `:id` param route (Express matches
// same-depth routes in registration order).
router.route('/promo-default.jpg')
  .get((req, res) => { (async () => { await controller.getDefaultPromoImage(req, res); })(); });

// POST /gig/:id/announce (#962) — admin-authed (ensureAuthenticated here, the
// controller's own privilege/role gate on top, mirroring VenueController /
// TemplateController). Registered before byId too; a different path depth
// than `/:id` so ordering doesn't actually matter here, but keeping the two
// `/:id/*` routes together reads clearer.
router.route('/:id/announce')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'announce', controller, authUtils);
    void action();
  });

routeUtils.byId(router, controller, authUtils);

export default router;

import express from 'express';
import controller from './promo-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Gig-promotion send routes. makeAction runs ensureAuthenticated (populates
// req.user from the token) before the controller's own capability/role check.
const router = express.Router();

router.route('/gig/email')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'sendGigEmail', controller, authUtils);
    void action();
  });

export default router;

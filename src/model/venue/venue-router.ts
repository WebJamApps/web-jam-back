import express from 'express';
import controller from './venue-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Venue management — booking-outreach data, NOT public (unlike /gig). Every
// route runs makeAction → ensureAuthenticated (populates req.user from the
// token); the controller then does the per-capability venue:* check
// (privilege-first, admin-role fallback). web-jam-back#819.
const router = express.Router();

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listVenues', controller, authUtils);
    void action();
  })
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'createVenue', controller, authUtils);
    void action();
  });

// GET /venue/cities — distinct non-empty city values (#980). Registered
// BEFORE /:id so Express doesn't swallow it as a :id lookup for "cities".
router.route('/cities')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listCities', controller, authUtils);
    void action();
  });

router.route('/:id')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getVenue', controller, authUtils);
    void action();
  })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'updateVenue', controller, authUtils);
    void action();
  })
  .delete((req, res) => {
    const action = routeUtils.makeAction(req, res, 'deleteVenue', controller, authUtils);
    void action();
  });

// POST /venue/:id/touch — append one timeline event (#898). See
// venue-controller.addTouch for the touch shape + validation.
router.route('/:id/touch')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'addTouch', controller, authUtils);
    void action();
  });

export default router;

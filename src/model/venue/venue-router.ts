import express from 'express';
import { rateLimit } from 'express-rate-limit';
import controller from './venue-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Venue management — booking-outreach data, NOT public (unlike /gig). Every
// route runs makeAction → ensureAuthenticated (populates req.user from the
// token); the controller then does the per-capability venue:* check
// (privilege-first, admin-role fallback). web-jam-back#819.
const router = express.Router();

// Rate limiter for Google Places lookup routes (#1159): at most 60 requests
// a minute per caller, keyed on the Authorization header so no proxy setting changes.
export const placesRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    return (Array.isArray(authHeader) ? authHeader[0] : authHeader) || 'anonymous';
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});

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

// GET /venue/places/suggest — autocomplete suggestions via Places API (New) (#1159).
// Registered BEFORE /:id so Express does not read "places" as a venue id.
router.route('/places/suggest')
  .get(placesRateLimiter, (req, res) => {
    const action = routeUtils.makeAction(req, res, 'suggestPlaces', controller, authUtils);
    void action();
  });

// GET /venue/places/:placeId — place details via Places API (New) (#1159).
// Registered BEFORE /:id so Express does not read "places" as a venue id.
router.route('/places/:placeId')
  .get(placesRateLimiter, (req, res) => {
    const action = routeUtils.makeAction(req, res, 'getPlaceDetails', controller, authUtils);
    void action();
  });

router.route('/:id')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getVenue', controller, authUtils);
    void action();
  })
  .patch((req, res) => {
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

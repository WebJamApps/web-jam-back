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

// Rate limiter for GET /venue/listings/search (#1217): at most 60 requests a
// minute per caller, keyed directly on the Authorization header so no proxy
// setting changes.
export const listingsSearchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization;
    return typeof authHeader === 'string' && authHeader.trim() ? authHeader.trim() : 'anonymous';
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for Nominatim place discovery (#1219): at most 60 requests a
// minute per caller, keyed on the authenticated user ID (sub) derived from the
// Authorization header so multiple tokens for the same admin share one bucket.
export const discoverPlaceRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => {
    const sub = authUtils.extractSub(req);
    if (sub) return sub;
    const token = authUtils.extractToken(req);
    return token || 'anonymous';
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

// GET /venue/listings/search?q=<text> — search the Overture listings copy (#1217).
// Registered BEFORE /:id so Express does not read "listings" as a venue id.
router.route('/listings/search')
  .get(listingsSearchRateLimiter, (req, res) => {
    const action = routeUtils.makeAction(req, res, 'searchListings', controller, authUtils);
    void action();
  });

// GET /venue/discover/place?q=<text> — turn a place name into a position (#1219).
// Registered BEFORE /:id so Express does not read "discover" as a venue id.
router.route('/discover/place')
  .get(discoverPlaceRateLimiter, (req, res) => {
    const action = routeUtils.makeAction(req, res, 'discoverPlace', controller, authUtils);
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

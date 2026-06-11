import express from 'express';
import FacebookController from './FacebookController.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils, { Icontroller } from '../../lib/routeUtils.js';

const router = express.Router();
const controller = new FacebookController() as unknown as Icontroller;

// Public cached feed for the CollegeLutheran homepage.
router.route('/feed')
  .get((req, res) => { (async () => { await controller.getFeed(req, res); })(); });

// Admin "Reconnect Facebook" endpoint. makeAction runs ensureAuthenticated
// first (401 on bad token; AUTH_ROLES.facebook restricts which roles pass),
// then the controller, which returns 400 on a bad/expired user token.
router.route('/token')
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'updateToken', controller, authUtils);
    // eslint-disable-next-line no-void
    void action();
  });

export default router;

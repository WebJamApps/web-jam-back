import express from 'express';
import controller from './setlist-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

// GET /setlist + GET /setlist/:id are PUBLIC so Kevin can view a setlist and
// click to play without logging in (web-jam-back#937). setRoot's GET handler
// runs without ensureAuthenticated; POST/PUT/DELETE stay authenticated (admin
// JWT), consistent with the other collections.
routeUtils.setRoot(router, controller, authUtils);

router.route('/:id')
  .get((req, res) => { (async () => { await controller.findById(req, res); })(); })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'findByIdAndUpdate', controller, authUtils);
    // eslint-disable-next-line no-void
    void action();
  })
  .delete((req, res) => {
    const action = routeUtils.makeAction(req, res, 'findByIdAndDelete', controller, authUtils);
    // eslint-disable-next-line no-void
    void action();
  });

export default router;

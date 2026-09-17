import express from 'express';
import controller from './venue-mining-sweep-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listSweeps', controller, authUtils);
    void action();
  })
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'createSweep', controller, authUtils);
    void action();
  });

export default router;

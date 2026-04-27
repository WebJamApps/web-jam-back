import express from 'express';
import controller from './song-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

routeUtils.setRoot(router, controller, authUtils);
routeUtils.byId(router, controller, authUtils);
export default router;

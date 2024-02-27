import express from 'express';
import controller from './song-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

routeUtils.setRoot(router, controller, authUtils);
routeUtils.byId(router, controller, authUtils);
export default router;

import express from 'express';
import controller from './song-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

routeUtils.setRoot(router, controller as any, authUtils);
routeUtils.byId(router, controller as any, authUtils);
export default router;

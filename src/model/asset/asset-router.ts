import express, { Request, Response } from 'express';
import controller from './asset-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

const authAction = (method: string) => (req: Request, res: Response) => {
  const action = routeUtils.makeAction(req, res, method, controller, authUtils);
  void action();
};

router.route('/report').get(authAction('getYearlyReport'));
router.route('/').get(authAction('find')).post(authAction('create'));

routeUtils.byId(router, controller, authUtils);

export default router;

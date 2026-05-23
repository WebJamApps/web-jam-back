import express, { Request, Response } from 'express';
import controller from './admin-user-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

const router = express.Router();

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'find', controller, authUtils);
    void action();
  })
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'create', controller, authUtils);
    void action();
  });

routeUtils.byId(router, controller, authUtils);

router.route('/:id/token')
  .post((req: Request, res: Response) => {
    const action = routeUtils.makeAction(req, res, 'mintToken', controller, authUtils);
    void action();
  });

export default router;

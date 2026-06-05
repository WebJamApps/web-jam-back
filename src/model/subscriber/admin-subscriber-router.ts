import express from 'express';
import controller from './subscriber-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// ADMIN subscriber management. Mounted at /admin/subscriber, so authUtils gates
// every route on AUTH_ROLES.admin (same key as /admin/user) — no new env needed.
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

// GET/PUT/DELETE /admin/subscriber/:id (list-by-id, edit, remove), all authed.
routeUtils.byId(router, controller, authUtils);

export default router;

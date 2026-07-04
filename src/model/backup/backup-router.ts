import express from 'express';
import controller from './backup-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// ADMIN weekly Mongo backup (web-jam-tools#116). Mounted at /admin/backup, so
// authUtils gates every route on AUTH_ROLES.admin — same key as /admin/user and
// /admin/subscriber, no new env var needed — via the exact
// routeUtils.makeAction + authUtils.ensureAuthenticated path that already
// guards POST /outreach/advance. Triggered weekly by the Deno cron app (a
// no-expiry service JWT, createServiceJWT — see admin-user's mintToken route).
const router = express.Router();

router.route('/')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'runBackup', controller, authUtils);
    void action();
  });

export default router;

import express from 'express';
import controller from './outreach-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Outreach log + send-pitch (web-jam-back#823). Booking-outreach data, NOT
// public. Every route runs makeAction → ensureAuthenticated (populates req.user
// from the token); the controller then does the per-capability outreach:* check
// (privilege-first, admin-role fallback), same as venue (#819) / template (#822).
const router = express.Router();

// POST /outreach/send — render a template for a venue and email the pitch. Above
// /:id so "send" isn't parsed as an id.
router.route('/send')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'sendPitch', controller, authUtils);
    void action();
  });

// POST /outreach/advance — cadence engine tick (#824). Above /:id so "advance"
// isn't parsed as an id. Driven on a schedule by the Deno Cron (#100).
router.route('/advance')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'advanceCadence', controller, authUtils);
    void action();
  });

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listOutreach', controller, authUtils);
    void action();
  });

// Approval gate (#844): approve = the only normal path that sends; reject =
// decline a draft; preview = render the exact copy without sending (for the
// approval UI). Above /:id so the action segments aren't parsed as ids.
router.route('/:id/approve')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'approveOutreach', controller, authUtils);
    void action();
  });

router.route('/:id/reject')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'rejectOutreach', controller, authUtils);
    void action();
  });

router.route('/:id/preview')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'previewOutreach', controller, authUtils);
    void action();
  });

router.route('/:id')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getOutreach', controller, authUtils);
    void action();
  })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'updateOutreach', controller, authUtils);
    void action();
  });

export default router;

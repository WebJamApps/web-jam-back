import express from 'express';
import controller from './outreach-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Outreach log + batch send-pitch (web-jam-back#823, reworked to batch target-
// list approval in #844). Booking-outreach data, NOT public. Every route runs
// makeAction → ensureAuthenticated (populates req.user from the token); the
// controller then does the per-capability outreach:* check (privilege-first,
// admin-role fallback), same as venue (#819) / template (#822).
const router = express.Router();

// Static routes are declared above /:id so words like "send" / "batch" aren't
// parsed as an id.

// POST /outreach/send — send ONE pitch immediately to a vetted venue (#844).
// Body accepts an optional `customBody` (#900) — one-off wording woven into
// the rendered pitch ahead of the template copy; still goes through the full
// tracked pipeline (record, PITCH_CC, cadence).
router.route('/send')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'sendPitch', controller, authUtils);
    void action();
  });

// POST /outreach/batch — send the approved target list (#844). Body accepts
// an optional `customBody` (#900), applied to every venue in the batch.
router.route('/batch')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'sendBatch', controller, authUtils);
    void action();
  });

// GET /outreach/candidates — propose the eligible target list (#844).
router.route('/candidates')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getCandidates', controller, authUtils);
    void action();
  });

// GET /outreach/preview — render a venue's pitch email without sending (#844).
// Accepts an optional `customBody` query param (#900) so the woven-in wording
// can be reviewed before send.
router.route('/preview')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'previewByVenue', controller, authUtils);
    void action();
  });

// GET/PUT /outreach/config — read/toggle auto-approve (#844).
router.route('/config')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getOutreachConfig', controller, authUtils);
    void action();
  })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'setOutreachConfig', controller, authUtils);
    void action();
  });

// POST /outreach/advance — cadence engine tick (#824). Driven by the Deno Cron (#100).
router.route('/advance')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'advanceCadence', controller, authUtils);
    void action();
  });

// POST /outreach/check-replies — Gmail reply-detection tick (#825). IMAP scan;
// halts the cadence on matched replies + attaches an AI suggestion for review.
router.route('/check-replies')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'checkReplies', controller, authUtils);
    void action();
  });

// GET /outreach/replies/pending — the "replies to review" queue (#825).
router.route('/replies/pending')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listPendingReplies', controller, authUtils);
    void action();
  });

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listOutreach', controller, authUtils);
    void action();
  });

// POST /outreach/:id/apply-suggestion — Josh approves/edits/dismisses a reply
// suggestion (#825). The ONLY path that writes an AI suggestion onto a venue.
router.route('/:id/apply-suggestion')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'applySuggestion', controller, authUtils);
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
  })
  .delete((req, res) => {
    const action = routeUtils.makeAction(req, res, 'deleteOutreach', controller, authUtils);
    void action();
  });

export default router;

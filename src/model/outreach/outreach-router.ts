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
// Body accepts two optional, independent slots (#903, supersedes #900's
// prepend): `customIntro` REPLACES the template's own intro; `customBody` is
// INSERTED at the template's [Custom Body] marker. Still goes through the
// full tracked pipeline (record, PITCH_CC, cadence).
router.route('/send')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'sendPitch', controller, authUtils);
    void action();
  });

// POST /outreach/batch — send the approved target list (#844). Body accepts
// the same optional `customIntro` + `customBody` (#903), applied to every
// venue in the batch.
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
// Accepts optional `customIntro` + `customBody` query params (#903) so either
// slot can be reviewed before send.
router.route('/preview')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'previewByVenue', controller, authUtils);
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

// POST /outreach/:id/outcome — record an outcome (interested / not-interested
// / booked / target-filled) on a pitch (#898). The single choke point: stamps
// outcomeAt/outcomeBy, halts the cadence, writes the venue timeline event, and
// runs the not-interested/booked side effects (incl. the target-filled
// auto-flip on booking). See outreach-controller.recordOutcome.
router.route('/:id/outcome')
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'recordOutcome', controller, authUtils);
    void action();
  });

// GET /outreach/report — administrator-only index of the stored run reports
// (web-jam-back#1084, D-52/D-53). Declared on the SAME route as the POST
// below, ahead of /:id, so this path resolves here rather than falling
// through to GET /outreach/:id with `id` reading `report`.
// POST /outreach/report — save or update an outreach HTML run report (web-jam-back#1052).
router.route('/report')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listReports', controller, authUtils);
    void action();
  })
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'saveReport', controller, authUtils);
    void action();
  });

// GET /outreach/table-sort.js — static first-party table sorting and interaction script (web-jam-back#1055).
router.route('/table-sort.js')
  .get((req, res) => {
    controller.getTableSortScript(req, res);
  });

// GET /outreach/report/:weekend — public HTML report serving endpoint (web-jam-back#1052).
// DELETE /outreach/report/:weekend — authenticated HTML report takedown endpoint (web-jam-back#1052).
router.route('/report/:weekend')
  .get((req, res) => {
    (async () => {
      await controller.getReport(req, res);
    })();
  })
  .delete((req, res) => {
    const action = routeUtils.makeAction(req, res, 'deleteReport', controller, authUtils);
    void action();
  });

// Gate 1: target venue-set approval (web-jam-back#1078, D-39, D-40, D-41).
const handleVenueApprovalPost = (req: express.Request, res: express.Response) => {
  const action = routeUtils.makeAction(req, res, 'recordVenueApproval', controller, authUtils);
  void action();
};
const handleVenueApprovalGet = (req: express.Request, res: express.Response) => {
  const action = routeUtils.makeAction(req, res, 'getVenueApproval', controller, authUtils);
  void action();
};
router.route('/approval/venue-set').post(handleVenueApprovalPost).get(handleVenueApprovalGet);
router.route('/approval/venue-set/:batchId').get(handleVenueApprovalGet);
router.route('/approval/gate1').post(handleVenueApprovalPost).get(handleVenueApprovalGet);
router.route('/approval/gate1/:batchId').get(handleVenueApprovalGet);

// Gate 2: per-email draft fingerprints approval (web-jam-back#1078, D-39, D-40, D-41).
const handleDraftApprovalPost = (req: express.Request, res: express.Response) => {
  const action = routeUtils.makeAction(req, res, 'recordDraftApproval', controller, authUtils);
  void action();
};
const handleDraftApprovalGet = (req: express.Request, res: express.Response) => {
  const action = routeUtils.makeAction(req, res, 'getDraftApproval', controller, authUtils);
  void action();
};
router.route('/approval/draft-fingerprints').post(handleDraftApprovalPost).get(handleDraftApprovalGet);
router.route('/approval/draft-fingerprints/:batchId').get(handleDraftApprovalGet);
router.route('/approval/gate2').post(handleDraftApprovalPost).get(handleDraftApprovalGet);
router.route('/approval/gate2/:batchId').get(handleDraftApprovalGet);

// Combined batch approval read-back
router.route('/approval/:batchId')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getBatchApproval', controller, authUtils);
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

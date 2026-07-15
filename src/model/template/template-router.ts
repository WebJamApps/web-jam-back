import express from 'express';
import controller from './template-controller.js';
import authUtils from '../../auth/authUtils.js';
import routeUtils from '../../lib/routeUtils.js';

// Pitch-email templates — booking-outreach data, NOT public. Every route runs
// makeAction → ensureAuthenticated (populates req.user from the token); the
// controller then does the per-capability template:* check (privilege-first,
// admin-role fallback). web-jam-back#822.
const router = express.Router();

router.route('/')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'listTemplates', controller, authUtils);
    void action();
  })
  .post((req, res) => {
    const action = routeUtils.makeAction(req, res, 'createTemplate', controller, authUtils);
    void action();
  });

router.route('/assets/:ref')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getTemplateAsset', controller, authUtils);
    void action();
  });

router.route('/:id')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'getTemplate', controller, authUtils);
    void action();
  })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'updateTemplate', controller, authUtils);
    void action();
  })
  .delete((req, res) => {
    const action = routeUtils.makeAction(req, res, 'deleteTemplate', controller, authUtils);
    void action();
  });

export default router;

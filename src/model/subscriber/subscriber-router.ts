import express from 'express';
import controller from './subscriber-controller.js';

// PUBLIC subscriber routes — no auth. Opt-in form post + the confirm/unsubscribe
// link targets fans click from their email.
const router = express.Router();

router.route('/')
  .post((req, res, next) => { controller.optIn(req, res).catch(next); });

router.route('/confirm')
  .get((req, res, next) => { controller.confirm(req, res).catch(next); });

router.route('/unsubscribe')
  .get((req, res, next) => { controller.unsubscribe(req, res).catch(next); });

export default router;

import express from 'express';
import controller from './book-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

routeUtils.setRoot(router, controller, authUtils);

router.route('/one')
  .get((req, res) => controller.findOne(req, res))
  .put(authUtils.ensureAuthenticated, (req, res) => controller.findOneAndUpdate(req, res));

router.route('/:id')
  .put(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndUpdate(req, res))
  .get(authUtils.ensureAuthenticated, (req, res) => controller.findById(req, res))
  .delete(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndRemove(req, res));

router.route('/findcheckedout/:id')
  .get(authUtils.ensureAuthenticated, (req, res) => controller.findCheckedOut(req, res));

export default router;

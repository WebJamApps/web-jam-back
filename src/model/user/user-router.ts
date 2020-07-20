import express from 'express';
import controller from './user-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

router.route('/')
  .post(authUtils.ensureAuthenticated, (req, res) => controller.findByEmail(req, res));
routeUtils.byId(router, controller, authUtils);
// router.route('/:id')
//   .get(authUtils.ensureAuthenticated, (req, res) => controller.findById(req, res))
//   .put(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndUpdate(req, res))
//   .delete(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndRemove(req, res));
router.route('/auth/login')
  .post((req, res) => controller.login(req, res));
router.route('/auth/signup')
  .post((req, res) => controller.signup(req, res));
router.route('/auth/google')
  .post((req, res) => controller.google(req, res));
router.route('/auth/:id')
  .put((req, res) => controller.handleAuth(req, res));

export default router;

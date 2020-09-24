import express from 'express';
import controller from './user-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

router.route('/')
  .get((req, res) => (process.env.NODE_ENV !== 'production' ? controller.find(req, res)
    : /* istanbul ignore next */ res.status(401).json({ message: 'not authorized' })))
  .post(authUtils.ensureAuthenticated, (req, res) => controller.findByEmail(req, res));
routeUtils.byId(router, controller, authUtils);
router.route('/auth/login')
  .post((req, res) => controller.login(req, res));
router.route('/auth/signup')
  .post((req, res) => controller.signup(req, res));
router.route('/auth/google')
  .post((req, res) => controller.google(req, res));
// router.route('/auth/:id')
//   .put((req, res) => controller.handleAuth(req, res));

export default router;

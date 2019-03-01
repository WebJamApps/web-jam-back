const router = require('express').Router();
const controller = require('./book-controller');
const authUtils = require('../../auth/authUtils');
const routeUtils = require('../../lib/routeUtils');

routeUtils.setRoot(router, controller, authUtils);
// router.route('/')
//   .get((...args) => controller.find(...args))
//   .post(authUtils.ensureAuthenticated, (...args) => controller.create(...args))
//   .delete(authUtils.ensureAuthenticated, (...args) => controller.deleteMany(...args));

router.route('/one')
  .get((...args) => controller.findOne(...args))
  .put(authUtils.ensureAuthenticated, (...args) => controller.findOneAndUpdate(...args));

router.route('/:id', authUtils.ensureAuthenticated)
  .put((...args) => controller.findByIdAndUpdate(...args))
  .get((...args) => controller.findById(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

router.route('/findcheckedout/:id', authUtils.ensureAuthenticated)
  .get((...args) => controller.findCheckedOut(...args));

module.exports = router;

const router = require('express').Router();
const controller = require('./user-controller');
const authUtils = require('../../auth/authUtils');

router.route('/')
  .post(authUtils.ensureAuthenticated, (...args) => controller.findByEmail(...args));

router.route('/:id')
  .get(authUtils.ensureAuthenticated, (...args) => controller.findById(...args))
  .put(authUtils.ensureAuthenticated, (...args) => controller.findOneAndUpdate(...args))
  .delete(authUtils.ensureAuthenticated, (...args) => controller.findByIdAndRemove(...args));

router.route('/auth/login')
  .post((...args) => controller.login(...args));

router.route('/auth/:id')
  .put((...args) => controller.handleAuth(...args));


module.exports = router;

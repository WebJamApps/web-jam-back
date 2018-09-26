const router = require('express').Router();
const controller = require('./song-controller');
const authUtils = require('../../auth/authUtils');

router.route('/')
  .get((...args) => controller.find(...args))
  .post(authUtils.ensureAuthenticated, (...args) => controller.create(...args));
// router.route('/create', authUtils.ensureAuthenticated)
//   .post((...args) => controller.create(...args));

module.exports = router;

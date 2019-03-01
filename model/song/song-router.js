const router = require('express').Router();
const controller = require('./song-controller');
const authUtils = require('../../auth/authUtils');
const routeUtils = require('../../lib/routeUtils');

routeUtils.setRoot(router, controller, authUtils);
// router.route('/')
//   .get((...args) => controller.find(...args))
//   .post(authUtils.ensureAuthenticated, (...args) => controller.create(...args))
//   .delete(authUtils.ensureAuthenticated, (...args) => controller.deleteMany(...args));

module.exports = router;

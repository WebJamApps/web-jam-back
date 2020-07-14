const router = require('express').Router();
const controller = require('./song-controller');
const authUtils = require('../../auth/authUtils');
const routeUtils = require('../../lib/routeUtils');

routeUtils.setRoot(router, controller, authUtils);

module.exports = router;

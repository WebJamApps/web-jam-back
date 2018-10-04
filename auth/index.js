const express = require('express');
// const userController = require('../model/user/user-controller');
// const authUtils = require('./authUtils');
const authController = require('./auth.controller.js');
// var meController = require('./me.controller.js');
// var identSrv = require('./identSrv.js');
const google = require('./google.js');
// var linkedin = require('./linkedin.js');
// var twitter = require('./twitter.js');
// var facebook = require('./facebook.js');
// var github = require('./github.js');
// var live = require('./live.js');
// var yahoo = require('./yahoo.js');
// var foursquare = require('./foursquare');
const router = express.Router();
router.post('/signup', authController.signup);
router.post('/google', google.authenticate);
// router.post('/login', authController.login);
// router.post('/linkedin', linkedin.authenticate);
// router.post('/twitter', twitter.authenticate);
// router.post('/facebook', facebook.authenticate);
// router.post('/github', github.authenticate);
// router.post('/live', live.authenticate);
// router.post('/yahoo', yahoo.authenticate);
// router.post('/foursquare', foursquare.authenticate);
// router.post('/identSrv', identSrv.authenticate);
// router.get('/unlink/:provider', meController.unlink);
module.exports = router;

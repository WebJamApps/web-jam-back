

const express = require('express');
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
router.put('/validemail', authController.validemail);
router.post('/google', google.authenticate);
router.post('/login', authController.login);
router.put('/resetpass', authController.resetpass);
router.put('/passwdreset', authController.passwdreset);
// router.post('/linkedin', linkedin.authenticate);
// router.post('/twitter', twitter.authenticate);
// router.post('/facebook', facebook.authenticate);
// router.post('/github', github.authenticate);
// router.post('/live', live.authenticate);
// router.post('/yahoo', yahoo.authenticate);
// router.post('/foursquare', foursquare.authenticate);
// router.post('/identSrv', identSrv.authenticate);

// router.get('/me',authUtils.ensureAuthenticated, meController.getMe );
// router.put('/me',authUtils.ensureAuthenticated, meController.updateMe );
// router.use(authUtils.ensureAuthenticated); //auth only appied for following paths, not the paths above
// router.get('/me', meController.getMe );
// router.put('/me', meController.updateMe );
// router.get('/unlink/:provider', meController.unlink);
module.exports = router;

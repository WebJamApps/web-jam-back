const router = require('express').Router();
const controller = require('./book-controller');
const authUtils = require('../../auth/authUtils');

router.route('/')
  .get((...args) => controller.find(...args))
  .post(authUtils.ensureAuthenticated, (...args) => controller.create(...args))
  .delete(authUtils.ensureAuthenticated, (...args) => controller.deleteMany(...args));
// router.route('/getall')
//   .get((...args) => controller.find(...args))
// .post((...args) => controller.create(...args));
// router.route('/homepage')
//   .put((...args) => controller.updateHomePage(...args));
// router.route('/youthpage')
//   .put((...args) => controller.updateYouthPage(...args));
// router.route('/familypage')
//   .put((...args) => controller.updateFamilyPage(...args));
// router.route('/getHomeContent')
//   .get((...args) => controller.findByType(...args));
// router.route('/getYouthContent')
//   .get((...args) => controller.findByType2(...args));
// router.route('/getFamilyContent')
//   .get((...args) => controller.findByType3(...args));
// router.route('/getYouthPics')
//   .get((...args) => controller.getYouthPics(...args));
// router.route('/getFamilyPics')
//   .get((...args) => controller.getFamilyPics(...args));
// router.route('/deleteall', authUtils.ensureAuthenticated)
//   .delete((...args) => controller.deleteMany(...args));

router.route('/one')
  .get((...args) => controller.findOne(...args))
  .put(authUtils.ensureAuthenticated, (...args) => controller.findOneAndUpdate(...args));

// router.route('/create', authUtils.ensureAuthenticated)
//   .post((...args) => controller.create(...args));

router.route('/:id', authUtils.ensureAuthenticated)
  .put((...args) => controller.findByIdAndUpdate(...args))
  .get((...args) => controller.findById(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

router.route('/findcheckedout/:id', authUtils.ensureAuthenticated)
  .get((...args) => controller.findCheckedOut(...args));

module.exports = router;

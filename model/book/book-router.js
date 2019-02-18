const router = require('express').Router();
const controller = require('./book-controller');
const authUtils = require('../../auth/authUtils');

router.route('/getall')
  .get((...args) => controller.find(...args));
router.route('/homepage')
  .put((...args) => controller.updateHomePage(...args));
router.route('/youthpage')
  .put((...args) => controller.updateYouthPage(...args));
router.route('/getHomeContent')
  .get((...args) => controller.findByType(...args));
router.route('/getYouthContent')
  .get((...args) => controller.findByType2(...args));
router.route('/getFamilyContent')
  .get((...args) => controller.findByType3(...args));
router.route('/deleteall', authUtils.ensureAuthenticated)
  .delete((...args) => controller.deleteMany(...args));

router.route('/create', authUtils.ensureAuthenticated)
  .post((...args) => controller.create(...args));

router.route('/:id', authUtils.ensureAuthenticated)
  .put((...args) => controller.findByIdAndUpdate(...args))
  .get((...args) => controller.findById(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

router.route('/findcheckedout/:id', authUtils.ensureAuthenticated)
  .get((...args) => controller.findCheckedOut(...args));

module.exports = router;

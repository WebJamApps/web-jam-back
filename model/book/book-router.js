const router = require('express').Router();
const controller = require('./book-controller');
const authUtils = require('../../auth/authUtils');

router.route('/getall')
  .get((...args) => controller.find(...args));

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

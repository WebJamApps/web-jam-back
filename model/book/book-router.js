const controller = require('./book-controller');
const Router = require('express').Router;

const router = new Router();
const authUtils = require('../../auth/authUtils');

// router.route('/')
//   .get((...args) => controller.find(...args))
//   .post((...args) => controller.create(...args));

// router.route('/find/:title')
// .put((...args) => controller.update(...args))
// .get((...args) => controller.findByTitle(...args));
//   .delete((...args) => controller.remove(...args));
router.route('/getall')
.get((...args) => controller.find(...args));

router.route('/deleteall', authUtils.ensureAuthenticated)
.get((...args) => controller.remove(...args));

router.route('/create', authUtils.ensureAuthenticated)
.post((...args) => controller.create(...args));

router.route('/:id', authUtils.ensureAuthenticated)
.put((...args) => controller.update(...args))
.get((...args) => controller.findById(...args));

router.route('/findcheckedout/:id', authUtils.ensureAuthenticated)
.get((...args) => controller.findCheckedOut(...args));

module.exports = router;

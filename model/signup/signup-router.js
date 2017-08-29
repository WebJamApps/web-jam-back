const controller = require('./signup-controller');
const Router = require('express').Router;
const router = new Router();

// router.route('/')
//   .post((...args) => controller.find(...args));
//
// router.route('/:id')
// .put((...args) => controller.update(...args))
// .get((...args) => controller.findById(...args))
// .delete((...args) => controller.findByIdAndRemove(...args));

router.route('/create')
.post((...args) => controller.create(...args));


module.exports = router;

const controller = require('./user-controller');
const Router = require('express').Router;

const router = new Router();


router.route('/')
  .post((...args) => controller.find(...args));
//   .post((...args) => controller.create(...args));

router.route('/:id')
  .put((...args) => controller.update(...args))
  .get((...args) => controller.findById(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

// router.route('/delete/:id')
// .get((...args) => controller.findByIdAndRemove(...args));

module.exports = router;

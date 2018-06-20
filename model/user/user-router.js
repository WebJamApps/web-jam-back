const controller = require('./user-controller');
const router = require('express').Router();

router.route('/')
  .post((...args) => controller.find(...args)); // find by email

router.route('/:id')
  .get((...args) => controller.findById(...args))
  .put((...args) => controller.update(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

module.exports = router;

const router = require('express').Router();
const controller = require('./user-controller');

router.route('/')
  .post((...args) => controller.find(...args)); // find by email

router.route('/:id')
  .get((...args) => controller.findById(...args))
  .put((...args) => controller.findOneAndUpdate(...args))
  .delete((...args) => controller.findByIdAndRemove(...args));

module.exports = router;

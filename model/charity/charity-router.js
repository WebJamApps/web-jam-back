const controller = require('./charity-controller');
// const Router = require('express').Router;
const router = require('../../lib/router-base');

router.route('/create')
  .post((...args) => controller.create(...args));

router.route('/:id')
  .get((...args) => controller.find(...args)) // the id for this get request is the manager id
  .delete((...args) => controller.findByIdAndRemove(...args))
  .put((...args) => controller.update(...args));

router.route('/find/:id')
  .get((...args) => controller.findById(...args));

module.exports = router;

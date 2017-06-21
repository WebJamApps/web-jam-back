const controller = require('./charity-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/:id')
.get((...args) => controller.find(...args))
.delete((...args) => controller.findByIdAndRemove(...args));

module.exports = router;

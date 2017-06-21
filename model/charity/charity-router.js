const controller = require('./charity-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/:id')
.get((...args) => controller.find(...args));

module.exports = router;

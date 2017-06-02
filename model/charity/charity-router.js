const controller = require('./charity-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/create')
.post((...args) => controller.create(...args));

module.exports = router;

const controller = require('./volOpp-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/getall')
.get((...args) => controller.find(...args));

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/:id')
.get((...args) => controller.findByCharityId(...args)) // get id is the charity that has a scheduled event
.delete((...args) => controller.findByIdAndRemove(...args))
.put((...args) => controller.update(...args));

router.route('/get/:id')
.get((...args) => controller.findById(...args));

module.exports = router;

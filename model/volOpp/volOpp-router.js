const controller = require('./volOpp-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/:id')
// the id for this get request is the user id
.get((...args) => controller.find(...args))
.delete((...args) => controller.findByIdAndRemove(...args))
.put((...args) => controller.update(...args));

module.exports = router;
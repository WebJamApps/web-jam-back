const controller = require('./volOpp-controller');
const Router = require('express').Router;
const router = new Router();

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/:id')
// the id for charity that has a scheduled event
.get((...args) => controller.find(...args));
// .delete((...args) => controller.findByIdAndRemove(...args))
// .put((...args) => controller.update(...args));
router.route('/get/:id')
.get((...args) => controller.findById(...args));

module.exports = router;

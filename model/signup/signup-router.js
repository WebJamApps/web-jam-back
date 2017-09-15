const controller = require('./signup-controller');
const Router = require('express').Router;
const router = new Router();

// router.route('/')
//   .post((...args) => controller.find(...args));
//
router.route('/getall')
.get((...args) => controller.find(...args));

router.route('/remove/:id')
.delete((...args) => controller.removeByUserId(...args));

router.route('/:id')
// .put((...args) => controller.update(...args))
.get((...args) => controller.findByUserId(...args)) // this is the user id
.delete((...args) => controller.remove(...args)); // this is the event id

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/event/:id')
.get((...args) => controller.findByEventId(...args)); // this is the event id

module.exports = router;

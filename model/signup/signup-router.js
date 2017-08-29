const controller = require('./signup-controller');
const Router = require('express').Router;
const router = new Router();

// router.route('/')
//   .post((...args) => controller.find(...args));
//
router.route('/:id')
// .put((...args) => controller.update(...args))
.get((...args) => controller.find(...args)) // this is the user id
.delete((...args) => controller.remove(...args)); // this is the event id

router.route('/create')
.post((...args) => controller.create(...args));


module.exports = router;

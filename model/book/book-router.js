const controller = require('./book-controller');
const Router = require('express').Router;
const router = new Router();


// router.route('/')
//   .get((...args) => controller.find(...args))
//   .post((...args) => controller.create(...args));

// router.route('/find/:title')
// .put((...args) => controller.update(...args))
// .get((...args) => controller.findByTitle(...args));
//   .delete((...args) => controller.remove(...args));
router.route('/getall')
.get((...args) => controller.find(...args));

router.route('/create')
.post((...args) => controller.create(...args));

router.route('/update/:id')
.put((...args) => controller.update(...args));

module.exports = router;

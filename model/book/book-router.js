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

// router for a particular book title.
// router.route("/find/:title")
//   .get((...args) => controller.findOne(...args));

router.route('/')
  .post((...args) => controller.create(...args));

module.exports = router;

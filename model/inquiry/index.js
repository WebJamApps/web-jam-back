const router = require('express').Router();
const InquiryController = require('./InquiryController');

const controller = new InquiryController();

router.route('/')
  .post((...args) => controller.handleInquiry(...args));

module.exports = router;

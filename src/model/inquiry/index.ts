import express from 'express';
import InquiryController from './InquiryController.js';

const router = express.Router();

const controller = new InquiryController();

router.route('/')
  .post(async (req, res, next) => {
    try {
      await controller.handleInquiry(req, res);
    } catch (err) {
      next(err);
    }
  });

export default router;

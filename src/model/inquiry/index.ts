import express from 'express';
import InquiryController from './InquiryController';

const router = express.Router();

const controller = new InquiryController();

router.route('/')
  .post((req, res) => { (async () => { await controller.handleInquiry(req, res); })(); });

export default router;

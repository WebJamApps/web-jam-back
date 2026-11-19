import express from 'express';
import { rateLimit } from 'express-rate-limit';
import InquiryController from './InquiryController.js';

const router = express.Router();

const controller = new InquiryController();

// Check 1: Sending limit — at most 5 submissions per hour from one client address.
export const inquiryRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});

router.route('/')
  .post(inquiryRateLimiter, async (req, res, next) => {
    try {
      await controller.handleInquiry(req, res);
    } catch (err) {
      next(err);
    }
  });

export default router;

import express from 'express';
import LivestreamController from './LivestreamController.js';

const router = express.Router();

const controller = new LivestreamController();

router.route('/current')
  .get(async (req, res, next) => {
    try {
      await controller.getCurrent(req, res);
    } catch (err) {
      next(err);
    }
  });

export default router;

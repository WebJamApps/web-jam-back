import express, { Request, Response } from 'express';
import { getBackupStatus } from './backup-scheduler.js';

const router = express.Router();

router.get('/status', (_req: Request, res: Response) => {
  const status = getBackupStatus();
  if (status.cannotTell) {
    return res.status(500).json({ message: status.error || 'cannot tell: Dropbox could not be read' });
  }
  return res.json({
    newestGoodRun: status.newestGoodRun,
    lastRunFailed: status.lastRunFailed,
  });
});

export default router;

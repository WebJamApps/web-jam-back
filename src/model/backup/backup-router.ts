import express from 'express';
import controller from './backup-controller.js';
import topAdminGuard from './top-admin-guard.js';

// Top-level admin MongoDB backup routes (web-jam-tools#1083, web-jam-back#1143, web-jam-back#1145).
// Gated exclusively on the top-level admin role (Developer).
// Does not rely on the AUTH_ROLES setting.
const router = express.Router();

router.use(topAdminGuard);

router.route('/diagram/database')
  .get((req, res) => {
    controller.getDatabaseDiagram(req, res);
  });

router.route('/diagram/system')
  .get((req, res) => {
    controller.getSystemDiagram(req, res);
  });

router.route('/runs')
  .get((req, res) => {
    controller.listRuns(req, res);
  })
  .post((req, res) => {
    controller.startRun(req, res);
  });

router.route('/runs/:name/restore')
  .post((req, res) => {
    controller.startRestore(req, res);
  });

router.route('/runs/:name/copy-to-dev')
  .post((req, res) => {
    controller.startCopyToDev(req, res);
  });

router.route('/operations/:name')
  .get((req, res) => {
    controller.getOperation(req, res);
  });

router.route('/')
  .post((req, res) => {
    controller.runBackup(req, res);
  });

export default router;

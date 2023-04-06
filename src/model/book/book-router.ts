import express from 'express';
import controller from './book-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

routeUtils.setRoot(router, controller as any, authUtils);
router.route('/one')
  .get((req, res) => { (async () => { await controller.findOne(req, res); })(); })
  .put((req, res) => {
    (async () => {
      try {
        await authUtils.ensureAuthenticated(req);
        await controller.findOneAndUpdate(req, res);
      } catch (err) { res.status(401).json({ message: (err as Error).message }); }
    })();
  });

routeUtils.byId(router, controller, authUtils);

router.route('/findcheckedout/:id')
  .get((req, res) => {
    (async () => {
      try {
        await authUtils.ensureAuthenticated(req);
        await controller.findCheckedOut(req, res);
      } catch (err) { res.status(401).json({ message: (err as Error).message }); }
    })();
  });

export default router;

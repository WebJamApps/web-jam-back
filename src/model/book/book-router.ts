import express from 'express';
import controller from './book-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

routeUtils.setRoot(router, controller, authUtils);
router.route('/one')
  .get((req, res) => { (async () => { await controller.findOne(req, res); })(); })
  .put((req, res) => {
    const action = routeUtils.makeAction(req, res, 'findOneAndUpdate', controller, authUtils);
    // eslint-disable-next-line no-void
    void action();
  });

routeUtils.byId(router, controller, authUtils);

router.route('/findcheckedout/:id')
  .get((req, res) => {
    const action = routeUtils.makeAction(req, res, 'findCheckedOut', controller, authUtils);
    // eslint-disable-next-line no-void
    void action();
  });

export default router;

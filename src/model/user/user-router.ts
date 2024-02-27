import express from 'express';
import controller from './user-controller';
import authUtils from '../../auth/authUtils';
import routeUtils from '../../lib/routeUtils';

const router = express.Router();

router.route('/')
  .get((req, res) => {
    (async () => {
      if (process.env.NODE_ENV !== 'production') await controller.find(req, res);
      else res.status(401).json({ message: 'not authorized' });
    })();
  })
  .post((req, res) => { 
    (async () => {
      try {
        await authUtils.ensureAuthenticated(req);
        await controller.findByEmail(req, res); 
      } catch (err) { res.status(401).json({ message: (err as Error).message }); }
    })(); 
  });
routeUtils.byId(router, controller, authUtils);
router.route('/auth/google')
  .post((req, res) => { (async () => { await controller.google(req, res); })(); });

export default router;

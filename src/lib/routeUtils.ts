import { Router } from 'express';
import AuthUtils from '../auth/authUtils';
import Controller from './controller';

function setRoot(router: Router, controller: Controller, authUtils: typeof AuthUtils): void {
  router.route('/')
    .get((req, res) => { (async () => { await controller.find(req, res); })(); })
    .post((req, res) => {
      (async () => {
        try {
          await authUtils.ensureAuthenticated(req);
          await controller.create(req, res);
        } catch (err) { res.status(401).json({ message: (err as Error).message }); }
      })();
    })
    .delete((req, res, next) => {
      (async () => {
        try {
          await authUtils.ensureAuthenticated(req);
          await controller.deleteMany(req, res);
        } catch (err) { res.status(401).json({ message: (err as Error).message }); }
      })();
    });
}
function byId(router: Router, controller: Controller, authUtils: typeof AuthUtils): void {
  router.route('/:id')
    .get((req, res) => {
      (async () => {
        try {
          await authUtils.ensureAuthenticated(req);
          await controller.findById(req, res);
        } catch (err) { res.status(401).json({ message: (err as Error).message }); }
      })();
    })
    .put((req, res) => {
      (async () => {
        try {
          await authUtils.ensureAuthenticated(req);
          await controller.findByIdAndUpdate(req, res);
        } catch (err) { res.status(401).json({ message: (err as Error).message }); }
      })();
    })
    .delete((req, res) => {
      (async () => {
        try {
          await authUtils.ensureAuthenticated(req);
          await controller.findByIdAndRemove(req, res);
        } catch (err) { res.status(401).json({ message: (err as Error).message }); }
      })();
    });
}
export default { setRoot, byId };

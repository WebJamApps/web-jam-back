import { Router } from 'express';
import AuthUtils from '../auth/authUtils';

function setRoot(router: Router, controller: any, authUtils: typeof AuthUtils): void {
  router.route('/')
    .get((req, res) => controller.find(req, res))
    .post(authUtils.ensureAuthenticated, (req, res) => controller.create(req, res))
    .delete(authUtils.ensureAuthenticated, (req, res) => controller.deleteMany(req, res));
}
function byId(router: Router, controller: any, authUtils: typeof AuthUtils): void {
  router.route('/:id')
    .get(authUtils.ensureAuthenticated, (req, res) => controller.findById(req, res))
    .put(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndUpdate(req, res))
    .delete(authUtils.ensureAuthenticated, (req, res) => controller.findByIdAndRemove(req, res));
}
export default { setRoot, byId };

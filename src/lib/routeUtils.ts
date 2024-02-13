import { Router, Request, Response } from 'express';
import AuthUtils from '../auth/authUtils';

export interface Icontroller { [x: string]: (req: Request, res: Response) => Promise<any> }

const makeAction = (
  req: Request,
  res: Response,
  method: string,
  controller: { [x: string]: (req: Request, res: Response) => Promise<any> },
  authUtils: typeof AuthUtils,
) => async () => {
  try {
    await authUtils.ensureAuthenticated(req);
    // eslint-disable-next-line security/detect-object-injection
    await controller[method](req, res);
  } catch (err) { res.status(401).json({ message: (err as Error).message }); }
};

function setRoot(router: Router, controller: Icontroller, authUtils: typeof AuthUtils): void {
  router.route('/')
    .get((req, res) => { (async () => { await controller.find(req, res); })(); })
    .post((req, res) => {
      const action = makeAction(req, res, 'create', controller, authUtils);
      // eslint-disable-next-line no-void
      void action();
    })
    .delete((req, res) => {
      const action = makeAction(req, res, 'deleteMany', controller, authUtils);
      // eslint-disable-next-line no-void
      void action();
    });
}
function byId(router: Router, controller: Icontroller, authUtils: typeof AuthUtils): void {
  router.route('/:id')
    .get((req, res) => {
      const action = makeAction(req, res, 'findById', controller, authUtils);
      // eslint-disable-next-line no-void
      void action();
    })
    .put((req, res) => {
      const action = makeAction(req, res, 'findByIdAndUpdate', controller, authUtils);
      // eslint-disable-next-line no-void
      void action();
    })
    .delete((req, res) => {
      const action = makeAction(req, res, 'findByIdAndDelete', controller, authUtils);
      (async () => { await action(); })();
    });
}
export default { setRoot, byId, makeAction };

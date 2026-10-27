import express, { Request, Response } from 'express';
import { getOpenApiSpec } from './openapi-controller.js';

const router = express.Router();

router.get('/', (req: Request, res: Response) => {
  void getOpenApiSpec(req, res);
});

export default router;

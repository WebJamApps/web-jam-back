import path from 'path';
import type { Response, Request } from 'express';

const setupApollo = async (expressMiddleware:any, server:any, context:any, app:any) => {
  try {
    await server.start();
    console.log('apollo server started ...');
    app.use(
      '/graphql',
      expressMiddleware(server, {
        context,
      }),
    );
    app.get('*', (_req:Request, res:Response) => {
      res.sendFile(path.normalize(path.join(__dirname, '../../../JaMmusic/dist/index.html')));
    });
    app.use((_req:Request, res:Response) => res.status(404).send('not found'));
    /* istanbul ignore next */
    app.use((err: { status: number, message: string }, _req: Request, res: Response) => res.status(500).json({ message: err.message, error: err }));
  } catch (err) { /* istanbul ignore next */console.log((err as Error).message); }
};

export default { setupApollo };

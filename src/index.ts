import path from 'node:path';
import dotenv from 'dotenv';
import Debug from 'debug';
import express from 'express';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import enforce from 'express-sslify';
import utils from './lib/utils.js';
import { makeCorsOptions } from './lib/cors.js';
import ReadCSV from './ReadCSV/index.js';
import routes from './routes.js';
import songData from './model/song/reset-song.js';
import songModel from './model/song/song-schema.js';
import { seedSongsIfEmpty, type SongSeedTarget } from './model/song/seed-songs.js';
import { startFacebookRefresh } from './model/facebook/FacebookController.js';
import { startBackupScheduler } from './model/backup/backup-scheduler.js';

dotenv.config({ quiet: true });

const debug = Debug('web-jam-back:index');

/* Safety net: surface unhandled promise rejections as a log line instead
   of letting Node terminate the dev server. Caught the day SendGrid
   returned 401 ("Maximum credits exceeded") and the inquiry route's
   fire-and-forget IIFE swallowed the rejection past Express. */
/* istanbul ignore next */
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason); // eslint-disable-line no-console
});
const readCsv = new ReadCSV();

// The built JaMmusic bundle: FRONTEND_DIST_DIR when set (the e2e stack's per-run build), else the sibling clone.
export function resolveFrontendDistDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FRONTEND_DIST_DIR?.trim();
  if (override) return path.resolve(override);
  return path.normalize(path.join(import.meta.dirname, '../../JaMmusic/dist'));
}

type CspDirectives = Record<string, string[] | null>;

// One policy for every route. upgrade-insecure-requests is sent only in production; elsewhere it is
// set to null, because Helmet adds it by default and it would break local HTTP serving (e2e stack).
export function makeCspDirectives(env: NodeJS.ProcessEnv = process.env): CspDirectives {
  return {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'block-all-mixed-content': [],
    'font-src': ["'self'", 'https:', 'data:'],
    'frame-src': ["'self'", 'https://accounts.google.com', 'https://www.facebook.com', 'https://open.spotify.com',
      'https://w.soundcloud.com', 'https://www.youtube.com', 'https://dl.dropboxusercontent.com', 'https://js.stripe.com'],
    'frame-ancestors': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', 'https://dl.dropboxusercontent.com'],
    'media-src': ["'self'", 'https://dl.dropboxusercontent.com', 'https://*.dl.dropboxusercontent.com',
      'https://www.dropbox.com', 'https://cdn.plyr.io'],
    'object-src': ["'none'"],
    // https://cdn.tiny.cloud stays until the self-hosted TinyMCE JaMmusic build has deployed.
    'script-src': ["'self'", 'https://accounts.google.com', 'https://apis.google.com', 'https://cdn.tiny.cloud',
      'https://w.soundcloud.com', 'https://www.youtube.com', 'https://s.ytimg.com', 'https://cdnjs.cloudflare.com',
      'https://js.stripe.com', 'https://maps.googleapis.com'],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", 'https:', "'unsafe-inline'"],
    'upgrade-insecure-requests': env.NODE_ENV === 'production' ? [] : null,
    'connect-src': ["'self'", 'blob:', 'ws:', 'wss:', 'https://cdn.plyr.io', 'https://noembed.com',
      'https://maps.googleapis.com', 'https://places.googleapis.com'],
  };
}

// Allow-list built in lib/cors.ts: the AllowUrl env origins (JaMmusic +
// CollegeLutheran) plus timshermanmusic.com and its *.pages.dev previews (#885).
const corsOptions = makeCorsOptions();
const frontendDistDir = resolveFrontendDistDir();
const app = express();
// Trust Heroku's single proxy hop so req.ip reflects each visitor's own address (#973).
app.set('trust proxy', 1);

/* istanbul ignore next */
if (process.env.NODE_ENV === 'production' && process.env.BUILD_BRANCH === 'main') app.use(enforce.HTTPS({ trustProtoHeader: true }));
// Security headers go first, so static files (/) and the SPA fallback (/music) get the same policy.
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(helmet.contentSecurityPolicy({ directives: makeCspDirectives() }));
app.use(express.static(frontendDistDir));
app.use(cors(corsOptions));
// eslint-disable-next-line no-void
(async () => { await utils.mongoConnect(mongoose); })();
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('tiny'));
routes(app);
// Prime the CollegeLutheran Facebook feed cache and start the hourly refresh.
// No-ops under NODE_ENV=test (so unit tests don't hit the network).
startFacebookRefresh();
startBackupScheduler();
app.get('/*splat', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDistDir, 'index.html'));
});
app.use((_req: Request, res: Response) => res.status(404).send('not found'));
/* istanbul ignore next */
app.use((err: { status: number, message: string }, _req: Request, res: Response) => res.status(500).json({ message: err.message, error: err }));
/* istanbul ignore if */if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 7000;
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  app.listen(port, async () => {
    debug('running in debug mode');
    console.log(`Magic happens on port ${port}`); // eslint-disable-line no-console
    const result = await readCsv.run();
    debug(result);
  });
}
/* istanbul ignore else */if (process.env.NODE_ENV !== 'production') {
  (async () => {
    const { songs } = songData;
    try {
      return await seedSongsIfEmpty(songModel as unknown as SongSeedTarget, songs);
    } catch (e) /* istanbul ignore next */ { debug((e as Error).message); return (e as Error).message; }
  })();
}
debug(`isTTY?: ${process.stderr.isTTY}`);

export default app;

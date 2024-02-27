import path from 'path';
import dotenv from 'dotenv';
import Debug from 'debug';
import express from 'express';
import 'module-alias/register';
import { expressMiddleware } from '@apollo/server/express4';
import mongoose from 'mongoose';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import enforce from 'express-sslify';
import utils from './lib/utils';
import ReadCSV from './ReadCSV';
import routes from './routes';
import songData from './model/song/reset-song';
import songController from './model/song/song-controller';
import Controller from './lib/controller';
import apollo from './apollo';
import apolloSetup from './apollo/setup';

dotenv.config();

const debug = Debug('web-jam-back:index');
const readCsv = new ReadCSV();
const corsOptions = {
  origin: JSON.parse(process.env.AllowUrl || /* istanbul ignore next */'{}').urls,
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
const app = express();

/* istanbul ignore next */
if (process.env.NODE_ENV === 'production' && process.env.BUILD_BRANCH === 'master') app.use(enforce.HTTPS({ trustProtoHeader: true }));
app.use(express.static(path.normalize(path.join(__dirname, '../../JaMmusic/dist'))));
app.use(cors(corsOptions));
// eslint-disable-next-line no-void
(async () => { await utils.mongoConnect(mongoose); })();
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(helmet.contentSecurityPolicy({
  directives: {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'block-all-mixed-content': [],
    'font-src': ["'self'", 'https:', 'data:'],
    'frame-src': ["'self'", 'https://accounts.google.com', 'https://www.facebook.com', 'https://open.spotify.com',
      'https://w.soundcloud.com', 'https://www.youtube.com', 'https://dl.dropboxusercontent.com', 'https://js.stripe.com'],
    'frame-ancestors': ["'self'"],
    'img-src': ["'self'", 'data:', 'https:', 'https://dl.dropboxusercontent.com'],
    'media-src': ["'self'", 'https://dl.dropboxusercontent.com'],
    'object-src': ["'none'"],
    'script-src': ["'self'", 'https://accounts.google.com', 'https://maps.googleapis.com', 'https://apis.google.com', 'https://cdn.tiny.cloud',
      'https://w.soundcloud.com', 'https://www.youtube.com', 'https://s.ytimg.com', 'https://cdnjs.cloudflare.com', 'https://js.stripe.com'],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", 'https:', "'unsafe-inline'"],
    'upgrade-insecure-requests': [],
    'connect-src': ["'self'", 'ws:', 'wss:'],
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('tiny'));
routes(app);
const { server, context } = apollo;
(async () => { await apolloSetup.setupApollo(expressMiddleware, server, context, app); })();
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
      await (songController as unknown as Controller).deleteAllDocs();
      await (songController as unknown as Controller).createDocs(songs);
    } catch (e) /* istanbul ignore next */ { debug((e as Error).message); return Promise.resolve((e as Error).message); }
    return 'songs created';
  })();
}
debug(`isTTY?: ${process.stderr.isTTY}`);

export default app;

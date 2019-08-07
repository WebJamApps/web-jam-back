const path = require('path');
const debug = require('debug')('web-jam-back:index');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const bluebird = require('bluebird');
const cors = require('cors');
const enforce = require('express-sslify');
const config = require('./config');
const routes = require('./routes');

const corsOptions = {
  origin: JSON.parse(process.env.AllowUrl).urls,
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};
const app = express();

/* istanbul ignore if */
if (process.env.NODE_ENV === 'production' && process.env.BUILD_BRANCH === 'master') app.use(enforce.HTTPS({ trustProtoHeader: true }));
app.use(express.static(path.normalize(path.join(__dirname, 'frontend/dist'))));
app.use('/music', express.static(path.normalize(path.join(__dirname, 'JaMmusic/dist'))));
app.use('/shop', express.static(path.normalize(path.join(__dirname, 'WebJamShop/dist'))));
app.use(cors(corsOptions));
mongoose.Promise = bluebird;
let mongoDbUri = process.env.MONGO_DB_URI;
/* istanbul ignore else */
if (process.env.NODE_ENV === 'test') mongoDbUri = 'mongodb://testerOfTheYear:wj-te5ter!@ds115283.mlab.com:15283/web-jam-test';
mongoose.connect(mongoDbUri, { useNewUrlParser: true });
mongoose.set('useCreateIndex', true);
mongoose.set('useFindAndModify', false);
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('tiny'));
routes(app);
app.get('/music/*', (req, res) => {
  res.sendFile(path.normalize(path.join(__dirname, 'JaMmusic/dist/index.html')));
});
app.get('/shop/*', (req, res) => {
  res.sendFile(path.normalize(path.join(__dirname, 'WebJamShop/dist/index.html')));
});
app.get('*', (req, res) => {
  res.sendFile(path.normalize(path.join(__dirname, 'frontend/dist/index.html')));
});
app.use((err, req, res) => {
  res.status(err.status || 500)
    .json({ message: err.message, error: err });
});

// this if statement is only for mocha test that may spin up twice
/* istanbul ignore if */
if (!module.parent) {
  app.listen(config.server.port, () => {
    debug('running in debug mode');
    console.log(`Magic happens on port ${config.server.port}`); // eslint-disable-line no-console
  });
}

module.exports = app;


const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const bluebird = require('bluebird');
const config = require('./config');
const routes = require('./routes');
const cors = require('cors');
const enforce = require('express-sslify');

const corsOptions =
  {
    origin: JSON.parse(process.env.AllowUrl).urls,
    credentials: true,
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
  };
const app = express();

/* istanbul ignore if */
if (process.env.NODE_ENV === 'production') {
  app.use(enforce.HTTPS({ trustProtoHeader: true }));
}

app.use(express.static(path.normalize(path.join(__dirname, 'frontend/dist'))));

// Handle rejected promises globally
app.use((req, res, next) => {
  process.on('unhandledRejection', (reason, promise) => {
    /* istanbul ignore next */
    next(new Error(reason));
  });
  next();
});

app.use(cors(corsOptions));
mongoose.Promise = bluebird;
// mongoose.connect(process.env.MONGO_DB_URI);
mongoose.connect(process.env.MONGO_DB_URI, {
  /* other options */
});
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('tiny'));
routes(app);

app.get('*', (request, response) => {
  response.sendFile(path.normalize(path.join(__dirname, 'frontend/dist/index.html')));
});

if (!module.parent) {
  app.listen(config.server.port, () => {
    console.log(`Magic happens on port ${config.server.port}`);
  });
}

module.exports = app;


const path       = require('path');
const express    = require('express');
const mongoose   = require('mongoose');
const helmet     = require('helmet');
const bodyParser = require('body-parser');
const morgan     = require('morgan');
const bluebird   = require('bluebird');
const config = require('./config');
const routes = require('./routes');
const cors = require('cors');

// TODO: Figure out why process.env.NODE_ENV is undefined at start YES

const corsOptions =
{ origin: JSON.parse(process.env.AllowUrl).urls,
  credentials: true,
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};
// if(process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === undefined){
//   console.log("MONGO DB URI is: " + process.env.MONGO_DB_URI)
// };
//
// if(process.env.NODE_ENV === 'test') {
//   console.log("MONGO DB URI is: " + process.env.MONGO_DB_URI)
// };
const app  = express();
app.use(express.static(path.normalize(path.join(__dirname, 'frontend/dist'))));

// app.use(function(req, res, next){
//   //cors(corsOptions);
// //   res.setHeader("Access-Control-Allow-Origin", "*");
// //   // res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
// res.setHeader('Access-Control-Allow-Headers', "Origin, X-Requested-With, Content-Type, Accept");
// res.setHeader('Access-Control-Allow-Credentials', true);
// next();
// })
app.use(cors(corsOptions));
mongoose.Promise = bluebird;
mongoose.connect(process.env.MONGO_DB_URI);
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan('tiny'));
// app.use('/', routes);
routes(app);
app.listen(config.server.port, () => {
  console.log(`Magic happens on port ${config.server.port}`);
});
module.exports = app;

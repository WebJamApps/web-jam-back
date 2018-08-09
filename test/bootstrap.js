global.bluebird = require('bluebird');
global.chai = require('chai');
global.chaiHttp = require('chai-http');
global.sinon = require('sinon');
global.mongoose = require('mongoose');
// global.server = require('../index');
require('sinon-mongoose');

mongoose.Promise = bluebird;
process.env.NODE_ENV = 'test';
process.env.MONGO_DB_URI = 'mongodb://developer:developer@ds147520.mlab.com:47520/web-jam-dev';

// SET MORE GLOBALS
global.expect = chai.expect;
// global.allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
chai.use(chaiHttp);

global.bluebird = require('bluebird');
global.chai = require('chai');
global.chaiHttp = require('chai-http');
global.sinon = require('sinon');
global.mongoose = require('mongoose');
global.mockgoose = require('mockgoose');

mongoose.Promise = bluebird;
process.env.NODE_ENV = 'test';
process.env.MONGO_DB_URI = 'localhost';
global.expect = chai.expect;
chai.use(chaiHttp);

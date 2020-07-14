const dotenv = require('dotenv');
// const fs = require('fs');
// // ignoring this for testing because it is only used for development purposes
// /* istanbul ignore next */
// if (fs.existsSync('../.env')) 
const result = dotenv.config();
if (result.error) { throw result.error; }
const config = {
  environment: process.env.NODE_ENV,
  server: {
    port: process.env.PORT,
  },
  mongo: {
    url: process.env.MONGO_DB_URI,
  },
  hashString: process.env.HashString,
  frontURL: process.env.frontURL,
};

module.exports = config;

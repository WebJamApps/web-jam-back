
const dotenv = require('dotenv');

dotenv.config();

const config = {
  environment: process.env.NODE_ENV,
  server: {
    port: process.env.PORT
  },
  mongo: {
    url: process.env.MONGO_DB_URI
  },
  hashString: process.env.HashString
};


module.exports = config;

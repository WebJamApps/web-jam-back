import express from 'express';
import user from './model/user/user-router';
import book from './model/book/book-router';
import inquiry from './model/inquiry';
// const charity = require('./model/charity/charity-router');
// const volOpp = require('./model/volOpp/volOpp-router');
import song from './model/song/song-router';

const router = express.Router();
// const authUtils = require('./auth/authUtils');

export default function route(app): void {
  app.use(router);
  router.use('/user', user);
  router.use('/book', book);
  router.use('/song', song);
  router.use('/inquiry', inquiry);
  // router.use('/charity', authUtils.ensureAuthenticated, charity);
  // router.use('/volopp', authUtils.ensureAuthenticated, volOpp);
}

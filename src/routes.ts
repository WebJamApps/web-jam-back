import express, { Express } from 'express';
import user from './model/user/user-router.js';
import book from './model/book/book-router.js';
import inquiry from './model/inquiry/index.js';
import song from './model/song/song-router.js';

const router = express.Router();

export default function route(app: Express): void {
  app.use(router);
  router.use('/user', user);
  router.use('/book', book);
  router.use('/song', song);
  router.use('/inquiry', inquiry);
}

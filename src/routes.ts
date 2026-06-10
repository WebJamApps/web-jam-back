import express, { Express } from 'express';
import user from './model/user/user-router.js';
import adminUser from './model/admin-user/admin-user-router.js';
import book from './model/book/book-router.js';
import inquiry from './model/inquiry/index.js';
import livestream from './model/livestream/index.js';
import song from './model/song/song-router.js';
import subscriber from './model/subscriber/subscriber-router.js';
import adminSubscriber from './model/subscriber/admin-subscriber-router.js';
import promo from './model/promo/promo-router.js';
import facebook from './model/facebook/index.js';

const router = express.Router();

export default function route(app: Express): void {
  app.use(router);
  router.use('/user', user);
  router.use('/admin/user', adminUser);
  router.use('/book', book);
  router.use('/song', song);
  router.use('/inquiry', inquiry);
  router.use('/livestream', livestream);
  router.use('/subscriber', subscriber);
  router.use('/admin/subscriber', adminSubscriber);
  router.use('/promo', promo);
  router.use('/facebook', facebook);
}

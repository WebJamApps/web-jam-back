const Router = require('express').Router;
const router = new Router();
const user = require('./model/user/user-router');
const book = require('./model/book/book-router');
const charity = require('./model/charity/charity-router');
const volOpp = require('./model/volOpp/volOpp-router');
const auth = require('./auth');
const authUtils = require('./auth/authUtils');

module.exports = function(app) {
    app.use(router);
    router.use('/auth', auth);
    router.use('/user', authUtils.ensureAuthenticated, user);
    router.use('/book', book);
    router.use('/charity', authUtils.ensureAuthenticated, charity);
    router.use('/volopp', authUtils.ensureAuthenticated, volOpp);
};

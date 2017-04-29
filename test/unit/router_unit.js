// const express = require('express'),
//     path = require("path"),
//     bookrouter = path.resolve("routes.js");
//
//
// describe('GET /ping', function () {
//   var app, getBookStub, request, route, controller;
//
//   beforeEach(function () {
//     getBookStub = sinon.stub();
//     controller = sinon.stub();
//     app = express();
//     route = proxyquire(bookrouter, {
//       '../../model/book/book-schema.js': {
//         getall: getBookStub
//       }
//     });
//
//     route(app);
//     request = supertest(app);
//   });
//
//   it('should respond with 200 and a book object', function (done) {
//
//     request
//     .get('/')
//     .expect('Content-Type', /json/)
//     .expect(200, function (err, res) {
//       expect(res).to.have.status(200);
//       console.log(res.body);
//       done();
//     });
//   });
// });
//

const Book1 = require('../../model/book/book-schema');
const authUtils = require('../../auth/authUtils');

describe('The library feature',  () => {
  beforeEach((done) => {
    Book1.collection.drop();
    Book1.ensureIndexes(() => {
      mockgoose(mongoose).then(() => {
        allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
        global.server = require('../../index'); // eslint-disable-line global-require
        done();
      });
    });
  });
  it('should create a new book', (done) => {
    chai.request(server)
    .post('/book/create')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send({ title: 'foobar', type: 'book' })
    .end((err, res) => {
      // expect(res).to.have.status(201);
      done();
    });
  });
  
  it('should raise error when no books are found', (done) => {
    chai.request(server)
    .get('/book/getall')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ')
    .end((err, res) => {
      expect(res).to.have.status(500);
      console.log(typeof res);
      done();
    });
  });
  
  it('should return all books', (done) => {
    const Book = new Book1();
    Book.title = 'foo2book';
    Book.type = 'pdf';
    Book.save((err) => {
      chai.request(server)
      .get('/book/getall')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ')
      .end((err, res) => {
        expect(res).to.have.status(200);
        done();
      });
    });
  });
  
  it('should post an array of new books', (done) => {
    chai.request(server)
    .post('/book/create')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
    .send([{ title: 'foobar', type: 'book' }, { title: 'JFK', type: 'PDF' }])
    .end((err, res) => {
      // expect(res).to.have.status(201);
      done();
    });
  });
  
  // when you call with a non-existent path, be sure to get a 404.
  it('should pass for the error', (done) => {
    chai.request(server)
    .put('/book/johnny')
    .set({ origin: allowedUrl })
    .set('authorization', 'Bearer ')
    .end((err, res) => {
      expect(res).to.have.status(404);
      done();
    });
  });
  
  // it('should respond with error on find a book', (done) => {
  //   chai.request(server)
  //   .get('/book/find/one')
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
  //   .end((err, res) => {
  //     console.log(res.status);
  //     // expect(res).to.have.status(200);
  //     done();
  //   });
  // });
});

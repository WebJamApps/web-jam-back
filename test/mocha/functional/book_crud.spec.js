const Book1 = require('../../../model/book/book-schema');
const authUtils = require('../../../auth/authUtils');

describe('The library feature', () => {
  let server, find, create, allowedUrl;
  beforeEach(async () => {
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    server = require('../../../index'); // eslint-disable-line global-require
    // global.server = require('../../index'); // eslint-disable-line global-require
    find = await sinon.mock(Book1, 'find');
    create = await sinon.mock(Book1, 'create');
  });

  afterEach(async () => {
    find.restore();
    create.restore();
  });

  it('should create a new book', (done) => {
    chai.request(server)
      .post('/book/create')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({ title: 'foobar', type: 'book' })
      .end((err, res) => {
        expect(res).to.have.status(201);
        done();
      });
  });

  it('should remove all books', (done) => {
    chai.request(server)
      .get('/book/deleteall')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({})
      .end((err, res) => {
        console.log(res.status);
        expect(res).to.have.status(200);
        done();
      });
  });

  it('should find checked out books', (done) => {
    const Book = new Book1();
    Book.title = 'foo2';
    Book.type = 'paperback';
    Book.checkedOutBy = ['33333'];
    chai.request(server)
      .get('/book/findcheckedout/33333')
      .set({ origin: allowedUrl })
      .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
      .send({})
      .end((err, res) => {
        console.log(res.status);
        expect(res).to.have.status(200);
        done();
      });
  });

  //
  // it('should raise error when no books are found', (done) => {
  //   Book1.collection.drop();
  //   chai.request(server)
  //   .get('/book/getall')
  //   .set({ origin: allowedUrl })
  //   .set('authorization', 'Bearer ')
  //   .end((err, res) => {
  //     expect(res).to.have.status(500);
  //     console.log(typeof res);
  //     done();
  //   });
  // });

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
        expect(res).to.have.status(400);
        done();
      });
  });

  it('should modify a book', async () => {
    await Book1.remove({ title:'Flow Measurement' });
    const Book = new Book1();
    Book.title = 'Flow Measurement';
    Book.type = 'hardback';
    Book.checkedOutBy = '123456';
    const newBook = await Book.save();
    try {
      const cb = await chai.request(server)
        .put('/book/' + newBook.id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ' + authUtils.createJWT('foo2@example.com'))
        .send({ checkedOutBy: '' });
      expect(cb).to.have.status(200);
      expect(cb.body.nModified > 0).to.equal(true);
    } catch (e) { throw e; }
  });
  it('should find the book by id', async () => {
    await Book1.remove({ title:'Flow Measurement' });
    const Book2 = new Book1();
    Book2.title = 'Flow Measurement';
    Book2.type = 'hardback';
    Book2.checkedOutBy = '123456';
    const newBook = await Book2.save();
    try {
      const cb = await chai.request(server)
        .get('/book/' + newBook._id)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ');
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
});
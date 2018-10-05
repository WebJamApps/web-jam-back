const sinon = require('sinon');
require('sinon-mongoose');
const server = require('../../../index');
const Book1 = require('../../../model/book/book-schema');
const authUtils = require('../../../auth/authUtils');

describe('The library feature', () => {
  let find, allowedUrl;
  beforeEach(async () => {
    await Book1.deleteMany({});
    allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
    find = await sinon.mock(Book1, 'find');
  });
  afterEach(async () => {
    find.restore();
  });
  it('creates a new book', async () => {
    let cb;
    try {
      cb = await chai.request(server)
        .post('/book/create')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ title: 'foobar', type: 'book' });
      expect(cb).to.have.status(201);
    } catch (e) { throw e; }
  });
  it('deletes all books', async () => {
    try {
      const cb = await chai.request(server)
        .delete('/book/deleteall')
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({});
      expect(cb.status).to.equal(200);
    } catch (e) { throw e; }
  });
  it('finds the checked out books', (done) => {
    const Book = new Book1();
    Book.title = 'foo2';
    Book.type = 'paperback';
    Book.checkedOutBy = ['33333'];
    chai.request(server)
      .get('/book/findcheckedout/33333')
      .set({ origin: allowedUrl })
      .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
      .send({})
      .end((err, res) => {
        // console.log(res.status);
        expect(res).to.have.status(200);
        done();
      });
  });

  it('returns all books', (done) => {
    const Book = new Book1();
    Book.title = 'foo2book';
    Book.type = 'pdf';
    Book.save(() => {
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
  it('returns error on db.find when getting all books', async () => {
    const bMock = sinon.mock(Book1);
    bMock.expects('find').chain('exec').rejects(new Error('bad'));
    let cb;
    try {
      cb = await chai.request(server)
        .get('/book/getall')
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ');
      expect(cb).to.have.status(500);
    } catch (e) { throw e; }
    bMock.restore();
  });
  it('should post an array of new books', (done) => {
    chai.request(server)
      .post('/book/create')
      .set({ origin: allowedUrl })
      .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
      .send([{ title: 'foobar', type: 'book' }, { title: 'JFK', type: 'PDF' }])
      .end((err, res) => {
        expect(res).to.have.status(201);
        if (err) { throw err; }
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
    await Book1.deleteMany({});
    const Book = new Book1();
    Book.title = 'Flow Measurement';
    Book.type = 'hardback';
    Book.checkedOutBy = '123456';
    const newBook = await Book.save();
    try {
      const cb = await chai.request(server)
        .put(`/book/${newBook.id}`)
        .set({ origin: allowedUrl })
        .set('authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .send({ checkedOutBy: '' });
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
  it('should find the book by id', async () => {
    await Book1.deleteMany({});
    const Book2 = new Book1();
    Book2.title = 'Flow Measurement';
    Book2.type = 'hardback';
    Book2.checkedOutBy = '123456';
    const newBook = await Book2.save();
    try {
      const cb = await chai.request(server)
        .get(`/book/${newBook._id}`)
        .set({ origin: allowedUrl })
        .set('authorization', 'Bearer ');
      expect(cb).to.have.status(200);
    } catch (e) { throw e; }
  });
});

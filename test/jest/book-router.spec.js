const request = require('supertest');
const server = require('../../index');
const BookModel = require('../../model/book/book-facade');
const authUtils = require('../../auth/authUtils');

describe('The Picture API', () => {
  let r;
  const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
  beforeEach(async () => {
    await BookModel.deleteMany({});
  });
  it('should find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(server)
      .get('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
      .query({ type: 'paperback' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Best Test Book Ever');
  });
  it('should not find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(server)
      .get('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
      .query({ type: 'magazine' });
    expect(r.status).toBe(400);
  });
  // it('should catch error on find one book', async () => {
  //   await BookModel.create({
  //     title: 'Best Test Book Ever', type: 'paperback',
  //   });
  //   const bMock = sinon.mock(BookModel);
  //   bMock.expects('findOne').rejects(new Error('bad'));
  //   try {
  //     const cb = await request(server)
  //       .get('/book/one')
  //       .set({
  //         origin: allowedUrl,
  //       })
  //       .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
  //       .query({ type: 'magazine' });
  //     expect(cb.status).toBe(500);
  //   } catch (e) { throw e; }
  //   bMock.restore();
  // });
  it('should update one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(server)
      .put('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
      .query({ type: 'paperback' })
      .send({ title: 'Bad Book' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Bad Book');
  });
  it('deletes a book by id', async () => {
    const newBook = await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(server)
      .delete(`/book/${newBook._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
    expect(r.status).toBe(200);
  });
});

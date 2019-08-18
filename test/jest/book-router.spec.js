/* eslint-disable no-useless-catch */
const request = require('supertest');
const sinon = require('sinon');
const server = require('../../index');
const BookModel = require('../../model/book/book-facade');
const authUtils = require('../../auth/authUtils');

describe('The Picture API', () => {
  const allowedUrl = JSON.parse(process.env.AllowUrl).urls[0];
  beforeEach(async () => {
    await BookModel.deleteMany({});
  });
  it('should find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    try {
      const cb = await request(server)
        .get('/book/one')
        .set({
          origin: allowedUrl,
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .query({ type: 'paperback' });
      expect(cb.status).toBe(200);
      expect(cb.body.title).toBe('Best Test Book Ever');
    } catch (e) { throw e; }
  });
  it('should not find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    try {
      const cb = await request(server)
        .get('/book/one')
        .set({
          origin: allowedUrl,
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .query({ type: 'magazine' });
      expect(cb.status).toBe(400);
    } catch (e) { throw e; }
  });
  it('should catch error on find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    const bMock = sinon.mock(BookModel);
    bMock.expects('findOne').rejects(new Error('bad'));
    try {
      const cb = await request(server)
        .get('/book/one')
        .set({
          origin: allowedUrl,
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .query({ type: 'magazine' });
      expect(cb.status).toBe(500);
    } catch (e) { throw e; }
    bMock.restore();
  });
  it('should update one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    try {
      const cb = await request(server)
        .put('/book/one')
        .set({
          origin: allowedUrl,
        })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`)
        .query({ type: 'paperback' })
        .send({ title: 'Bad Book' });
      expect(cb.status).toBe(200);
      expect(cb.body.title).toBe('Bad Book');
    } catch (e) { throw e; }
  });
  it('deletes a book by id', async () => {
    const newBook = await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    try {
      const cb = await request(server)
        .delete(`/book/${newBook._id}`)
        .set({ origin: allowedUrl })
        .set('Authorization', `Bearer ${authUtils.createJWT('foo2@example.com')}`);
      expect(cb.status).toBe(200);
    } catch (e) { throw e; }
  });
});

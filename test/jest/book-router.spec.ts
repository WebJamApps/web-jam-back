import request from 'supertest';
import app from '../../src/index';
import BookModel from '../../src/model/book/book-facade';
import userModel from '../../src/model/user/user-facade';
import authUtils from '../../src/auth/authUtils';

describe('The Book API', () => {
  let r, newUser:any;
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  beforeAll(async () => {
    newUser = await userModel.create({ name: 'foo', email: 'foo3@example.com', userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0] });
  });
  beforeEach(async () => {
    const deleter:any = {};
    await BookModel.deleteMany(deleter);
  });
  it('should find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .get('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .query({ type: 'paperback' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Best Test Book Ever');
  });
  it('should not find one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .get('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: '123456' })}`)
      .query({ type: 'magazine' });
    expect(r.status).toBe(400);
  });
  it('should update one book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .put('/book/one')
      .set({
        origin: allowedUrl,
      })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .query({ type: 'paperback' })
      .send({ title: 'Bad Book' });
    expect(r.status).toBe(200);
    expect(r.body.title).toBe('Bad Book');
  });
  it('deletes a book by id', async () => {
    const newBook = await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .delete(`/book/${newBook._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('finds the checked out books', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback', checkedOutBy: '33333',
    });
    r = await request(app)
      .get('/book/findcheckedout/33333')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('updates a book by id', async () => {
    const newBook = await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback', checkedOutBy: '33333',
    });
    r = await request(app)
      .put(`/book/${newBook.id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({ checkedOutBy: '' });
    expect(r.status).toBe(200);
  });
  it('finds the book by id', async () => {
    const newBook = await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback', checkedOutBy: '33333',
    });
    r = await request(app)
      .get(`/book/${newBook._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`);
    expect(r.status).toBe(200);
  });
  it('gets all books', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .get('/book')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: '123456' })}`);
    expect(r.status).toBe(200);
  });
  it('creates a new book', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .post('/book')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .send({
        title: 'Best Test Book Ever', type: 'paperback',
      });
    expect(r.status).toBe(201);
  });
  it('deletes many books', async () => {
    await BookModel.create({
      title: 'Best Test Book Ever', type: 'paperback',
    });
    r = await request(app)
      .delete('/book')
      .set({ origin: allowedUrl })
      .set('Authorization', `Bearer ${authUtils.createJWT({ _id: newUser._id })}`)
      .query({ type: 'paperback' });
    expect(r.status).toBe(200);
  });
});

import app from '#src/index.js';
import SetlistModel from '#src/model/setlist/setlist-facade.js';
import SetlistSchema from '#src/model/setlist/setlist-schema.js';
import SongModel from '#src/model/song/song-facade.js';
import userModel from '#src/model/user/user-facade.js';
import authUtils from '#src/auth/authUtils.js';
import request, { type ApiResponse } from '../helpers/api.js';

describe('The Setlist API', () => {
  let r: ApiResponse, newUser: { _id: string; userType: string };
  const allowedUrl = JSON.parse(process.env.AllowUrl || '{}').urls[0];
  const auth = () => `Bearer ${authUtils.createJWT({ _id: newUser._id })}`;
  beforeAll(async () => {
    await SetlistModel.deleteMany({});
    await userModel.deleteMany({});
    const createdUser = await userModel.create({
      name: 'foo',
      email: 'setlist-foo@example.com',
      userType: JSON.parse(process.env.AUTH_ROLES || '{}').user[0],
    }) as unknown as { _id: { toString(): string }; userType: string };
    newUser = { _id: createdUser._id.toString(), userType: createdUser.userType };
  });
  beforeEach(async () => {
    await SetlistModel.deleteMany({});
  });

  it('gets all setlists without auth (public)', async () => {
    await SetlistModel.create({ name: 'Practice — Kevin', items: [{ order: 1, title: 'Wagon Wheel' }] });
    r = await request(app).get('/setlist').set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body[0].name).toBe('Practice — Kevin');
  });

  it('gets one setlist by id without auth (public)', async () => {
    const created = await SetlistModel.create({
      name: 'Gig Set',
      description: 'Saturday night',
      items: [{ order: 1, title: 'Folsom Prison Blues', playLink: 'https://youtu.be/abc' }],
    }) as unknown as { _id: string };
    r = await request(app).get(`/setlist/${created._id}`).set({ origin: allowedUrl });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Gig Set');
    expect(r.body.items[0].title).toBe('Folsom Prison Blues');
  });

  it('returns 400 for an invalid id', async () => {
    r = await request(app).get('/setlist/not-an-id').set({ origin: allowedUrl });
    expect(r.status).toBe(400);
  });

  it('creates a setlist with the admin JWT', async () => {
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: 'New Set', items: [{ order: 1, title: 'Ring of Fire', playLink: 'https://youtu.be/ring' }] });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('New Set');
    expect(r.body.items[0].order).toBe(1);
  });

  it('rejects a create without auth', async () => {
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .send({ name: 'No Auth Set' });
    expect(r.status).toBe(401);
  });

  it('rejects a create missing the required name (validation)', async () => {
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ items: [{ order: 1, title: 'Orphan' }] });
    expect(r.status).toBe(500);
  });

  it('rejects a create whose item is missing the required title (validation)', async () => {
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: 'Bad Item Set', items: [{ order: 1 }] });
    expect(r.status).toBe(500);
  });

  it('updates a setlist, replacing its items', async () => {
    const created = await SetlistModel.create({
      name: 'Old Name',
      items: [{ order: 1, title: 'Old Song' }],
    }) as unknown as { _id: string };
    r = await request(app)
      .put(`/setlist/${created._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: 'Updated Name', items: [{ order: 1, title: 'A' }, { order: 2, title: 'B' }] });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Updated Name');
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[1].title).toBe('B');
  });

  it('rejects an update that blanks the required name', async () => {
    const created = await SetlistModel.create({ name: 'Keep Me' }) as unknown as { _id: string };
    r = await request(app)
      .put(`/setlist/${created._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: '' });
    expect(r.status).toBe(400);
  });

  it('deletes a setlist by id', async () => {
    const created = await SetlistModel.create({ name: 'Temp Set' }) as unknown as { _id: string };
    r = await request(app)
      .delete(`/setlist/${created._id}`)
      .set({ origin: allowedUrl })
      .set('Authorization', auth());
    expect(r.status).toBe(200);
  });

  it('deletes many setlists', async () => {
    await SetlistModel.create({ name: 'Bulk Set' });
    r = await request(app)
      .delete('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .query({ name: 'Bulk Set' });
    expect(r.status).toBe(200);
  });

  describe('title/link resolution rules', () => {
    it('effectiveTitle is the item title', () => {
      const doc = new SetlistSchema({ name: 'S', items: [{ order: 1, title: 'My Title' }] });
      expect(doc.items[0].effectiveTitle).toBe('My Title');
    });

    it('effectivePlayLink uses the item playLink when present', () => {
      const doc = new SetlistSchema({ name: 'S', items: [{ order: 1, title: 'T', playLink: 'https://item.link' }] });
      expect(doc.items[0].effectivePlayLink).toBe('https://item.link');
    });

    it('effectivePlayLink is undefined when neither playLink nor song is present', () => {
      const doc = new SetlistSchema({ name: 'S', items: [{ order: 1, title: 'T' }] });
      expect(doc.items[0].effectivePlayLink).toBeUndefined();
    });

    it('effectivePlayLink falls back to the referenced Song url when populated and no playLink', async () => {
      await SongModel.deleteMany({ title: 'Setlist Ref Song' });
      const song = await SongModel.create({
        title: 'Setlist Ref Song',
        artist: 'The Band',
        category: 'pub',
        url: `https://youtu.be/song-${Date.now()}`,
      }) as unknown as { _id: string; url: string };
      const created = await SetlistModel.create({
        name: 'Ref Set',
        items: [{ order: 1, songId: song._id, title: 'Setlist Ref Song' }],
      }) as unknown as { _id: string };
      const populated = await SetlistSchema.findById(created._id).populate('items.songId');
      expect(populated.items[0].effectivePlayLink).toBe(song.url);
      await SongModel.deleteMany({ title: 'Setlist Ref Song' });
    });
  });

  it('should wait until tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

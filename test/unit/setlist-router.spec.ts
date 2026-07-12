import app from '#src/index.js';
import SetlistModel from '#src/model/setlist/setlist-facade.js';
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

  it('returns 400 for a well-formed id that does not exist', async () => {
    r = await request(app).get('/setlist/6a53da5b8c4f9aa55d290d99').set({ origin: allowedUrl });
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

  it('rejects a create whose item is missing both songId and title (validation)', async () => {
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: 'Bad Item Set', items: [{ order: 1 }] });
    expect(r.status).toBe(500);
  });

  it('accepts a create whose item has ONLY a songId — no inline title required', async () => {
    await SongModel.deleteMany({ title: 'Songid Only Validation Song' });
    const song = await SongModel.create({
      title: 'Songid Only Validation Song',
      artist: 'Some Artist',
      category: 'pub',
      url: `https://youtu.be/songid-only-${Date.now()}`,
    }) as unknown as { _id: string };
    r = await request(app)
      .post('/setlist')
      .set({ origin: allowedUrl })
      .set('Authorization', auth())
      .send({ name: 'SongId Only Set', items: [{ order: 1, songId: song._id }] });
    expect(r.status).toBe(201);
    await SongModel.deleteMany({ title: 'Songid Only Validation Song' });
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

  describe('hybrid songId resolution (web-jam-back#946)', () => {
    let song: { _id: string; url: string };

    beforeAll(async () => {
      await SongModel.deleteMany({ title: 'Setlist Ref Song' });
      song = await SongModel.create({
        title: 'Setlist Ref Song',
        artist: 'The Reference Band',
        category: 'pub',
        url: 'https://dl.dropboxusercontent.com/s/abc123/song.mp3?rlkey=xyz789&dl=1',
      }) as unknown as { _id: string; url: string };
    });

    afterAll(async () => {
      await SongModel.deleteMany({ title: 'Setlist Ref Song' });
    });

    it('resolves a referenced item to the Song title/artist and a converted (player-form) playLink on GET /setlist/:id', async () => {
      const created = await SetlistModel.create({
        name: 'Ref Set',
        items: [{ order: 1, songId: song._id, notes: 'watch the bridge' }],
      }) as unknown as { _id: string };
      r = await request(app).get(`/setlist/${created._id}`).set({ origin: allowedUrl });
      expect(r.status).toBe(200);
      const [item] = r.body.items;
      expect(item.title).toBe('Setlist Ref Song');
      expect(item.artist).toBe('The Reference Band');
      expect(item.playLink).toBe('https://www.dropbox.com/s/abc123/song.mp3?rlkey=xyz789&dl=0');
      expect(item.notes).toBe('watch the bridge');
      expect(item.songId).toBe(song._id.toString());
    });

    it('resolves a mixed setlist (referenced + inline) on GET /setlist and GET /setlist/:id', async () => {
      const created = await SetlistModel.create({
        name: 'Mixed Set',
        items: [
          { order: 1, songId: song._id },
          {
            order: 2, title: 'Uncatalogued Cover', artist: 'Cover Band', playLink: 'https://youtu.be/cover',
          },
        ],
      }) as unknown as { _id: string };

      const byId = await request(app).get(`/setlist/${created._id}`).set({ origin: allowedUrl });
      expect(byId.status).toBe(200);
      expect(byId.body.items[0].title).toBe('Setlist Ref Song');
      expect(byId.body.items[0].artist).toBe('The Reference Band');
      expect(byId.body.items[1].title).toBe('Uncatalogued Cover');
      expect(byId.body.items[1].artist).toBe('Cover Band');
      expect(byId.body.items[1].playLink).toBe('https://youtu.be/cover');

      const list = await request(app).get('/setlist').set({ origin: allowedUrl });
      expect(list.status).toBe(200);
      const found = (list.body as Array<{ _id: string }>).find((s) => s._id === created._id.toString());
      expect(found).toBeDefined();
    });
  });

  it('should wait until tests finish before exiting', async () => { // eslint-disable-line vitest/expect-expect
    // eslint-disable-next-line no-promise-executor-return
    const delay = (ms: number) => new Promise((resolve) => setTimeout(() => resolve(true), ms));
    await delay(3000);
  });
});

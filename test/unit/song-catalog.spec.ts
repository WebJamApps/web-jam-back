import express from 'express';
import mongoose from 'mongoose';
import router from '#src/model/song/song-router.js';
import Song from '#src/model/song/song-schema.js';
import facade from '#src/model/song/song-facade.js';
import { PUBLIC_SONG_FIELDS } from '#src/model/song/public-song.js';
import authUtils from '#src/auth/authUtils.js';
import request from '../helpers/api.js';

// Router tests use the real auth action and persistence facade with isolated
// documents, without importing the app (which connects and seeds on import).
const app = express();
app.use(express.json());
app.use('/song', router);
const rights = {
  writers: [{ name: 'Fictional Writer', share: 100 }],
  bmiWorkNumber: 'TEST-WORK-NOT-REAL',
  iswc: 'TEST-ISWC-NOT-REAL',
  copyrightRegistration: 'TEST-COPYRIGHT-NOT-REAL',
  recordings: [{ isrc: 'TEST-ISRC-NOT-REAL', artist: 'Fictional Performer', release: 'Fictional Release' }],
};

describe('Song catalog public boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns only the explicit public fields, even for fully populated rights and unknown future fields', async () => {
    vi.spyOn(facade, 'find').mockResolvedValue([{
      _id: 'fixture-id', title: 'Fictional Song', artist: 'Fictional Performer', category: 'original',
      composer: 'Legacy display text', album: 'Fictional Release', year: 2026,
      url: 'https://example.invalid/song', image: 'https://example.invalid/image', orderBy: 1,
      ...rights, futurePrivateField: 'must stay private',
    }]);
    const res = await request(app).get('/song');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual([...PUBLIC_SONG_FIELDS].sort());
    for (const key of Object.keys(rights)) expect(res.body[0]).not.toHaveProperty(key);
    expect(res.body[0]).not.toHaveProperty('futurePrivateField');
  });

  it('does not pass private-field or operator probes into public queries', async () => {
    const find = vi.spyOn(facade, 'find').mockResolvedValue([]);
    await request(app).get('/song').query({ title: 'Fictional Song', bmiWorkNumber: 'probe', '$where': 'probe' });
    expect(find).toHaveBeenCalledWith({ title: 'Fictional Song' });
  });

  it('returns a generic read error without leaking database/rights details', async () => {
    vi.spyOn(facade, 'find').mockRejectedValue(new Error('private rights failure'));
    const res = await request(app).get('/song');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Unable to read songs' });
  });

  it('requires login on reads by ID and every write', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    for (const res of await Promise.all([
      request(app).get(`/song/${id}`), request(app).post('/song').send({ title: 'Fictional' }),
      request(app).put(`/song/${id}`).send({ title: 'Changed' }), request(app).delete(`/song/${id}`),
    ])) expect(res.status).toBe(401);
  });

  it('allows an authenticated editor to create/read/update/delete private catalog details', async () => {
    vi.spyOn(authUtils, 'ensureAuthenticated').mockResolvedValue(undefined);
    const id = new mongoose.Types.ObjectId().toString();
    vi.spyOn(facade, 'create').mockResolvedValue({ _id: id, ...rights } as never);
    vi.spyOn(facade, 'findById').mockResolvedValue({ _id: id, ...rights });
    vi.spyOn(facade, 'findByIdAndUpdate').mockResolvedValue({ _id: id, ...rights });
    vi.spyOn(facade, 'findByIdAndDelete').mockResolvedValue({ _id: id });
    const body = { title: 'Fictional Song', artist: 'Fictional Performer', category: 'original', ...rights };
    expect((await request(app).post('/song').send(body)).status).toBe(201);
    expect((await request(app).get(`/song/${id}`)).body.writers).toEqual(rights.writers);
    expect((await request(app).put(`/song/${id}`).send({ writers: rights.writers })).status).toBe(200);
    expect((await request(app).delete(`/song/${id}`)).status).toBe(200);
  });

  it('accepts unrecorded songs and incomplete category-specific rights without inventing authorship', async () => {
    for (const category of ['original', 'pub', 'mission']) {
      const song = new Song({ title: 'Fictional Unrecorded Song', artist: 'Fictional Performer', category });
      expect(song.validateSync()).toBeUndefined();
      expect(song.recordings).toHaveLength(0);
      expect(song.writers).toHaveLength(0);
      expect(song.bmiWorkNumber).toBeUndefined();
    }
  });

  it('validates writer names and share bounds', () => {
    const song = new Song({ title: 'Fictional', artist: 'Fictional', category: 'original', writers: [{ share: 101 }] });
    expect(song.validateSync()?.errors).toHaveProperty('writers.0.name');
    expect(song.validateSync()?.errors).toHaveProperty('writers.0.share');
  });
});

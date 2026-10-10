// Seeding songs only into an empty collection (web-jam-back#1146). An in-memory song model;
// nothing here touches a real database.
import { seedSongsIfEmpty, type SongSeedTarget } from '#src/model/song/seed-songs.js';
import songData from '#src/model/song/reset-song.js';

type Doc = Record<string, unknown>;

function fakeSongs(existing: Doc[]) {
  const store = [...existing];
  const target: SongSeedTarget = {
    countDocuments: () => Promise.resolve(store.length),
    create: (docs) => { store.push(...docs); return Promise.resolve(docs); },
  };
  return { store, target };
}

describe('seedSongsIfEmpty', () => {
  it('seeds the built-in songs into an empty songs collection', async () => {
    const { store, target } = fakeSongs([]);
    expect(await seedSongsIfEmpty(target, songData.songs)).toBe('songs created');
    expect(store).toEqual(songData.songs);
    expect(store).toHaveLength(37);
  });

  it('leaves a non-empty songs collection exactly as it is', async () => {
    const existing = [{ title: 'Mine', artist: 'Josh', url: 'https://example.invalid/mine.mp3' }];
    const { store, target } = fakeSongs(existing);
    expect(await seedSongsIfEmpty(target, songData.songs)).toBe('songs left as they are');
    expect(store).toEqual(existing);
  });

  it('passes a failure through to the caller', async () => {
    const target: SongSeedTarget = {
      countDocuments: () => Promise.reject(new Error('db down')),
      create: () => Promise.resolve([]),
    };
    await expect(seedSongsIfEmpty(target, songData.songs)).rejects.toThrow('db down');
  });
});

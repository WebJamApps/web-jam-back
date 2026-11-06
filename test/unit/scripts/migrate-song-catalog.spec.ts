import mongoose from 'mongoose';
import { isLocalCopy, recordingBackfill, migrateSongCatalog, run, type CatalogStore } from '#src/scripts/migrate-song-catalog.js';

describe('staged song catalog migration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses missing, remote, and non-copy targets before connecting', async () => {
    const connect = vi.spyOn(mongoose, 'connect');
    expect(isLocalCopy('')).toBe(false);
    expect(isLocalCopy('https://example.invalid/copy')).toBe(false);
    expect(isLocalCopy(['mongodb:', '//remote.invalid/catalog-copy'].join(''))).toBe(false);
    await expect(run([], '')).rejects.toThrow('Refusing');
    await expect(run(['--force'], '')).rejects.toThrow('Only --apply');
    expect(connect).not.toHaveBeenCalled();
  });

  it('retains recordings metadata but never infers writers from composer or performer', () => {
    expect(recordingBackfill({ artist: 'Fictional Performer', composer: 'Unverified', url: 'https://example.invalid/a', album: 'Release', year: 2026 }))
      .toEqual([{ artist: 'Fictional Performer', url: 'https://example.invalid/a', release: 'Release', year: 2026 }]);
    expect(recordingBackfill({ title: 'Unrecorded' })).toEqual([]);
  });

  it('dry-runs without writes, applies additively to a copy, and changes nothing on a second apply', async () => {
    const songs: Record<string, unknown>[] = [
      { _id: 'legacy', title: 'Fictional Legacy', artist: 'Performer', composer: 'Unverified', url: 'https://example.invalid/a' },
      { _id: 'unrecorded', title: 'Fictional Unrecorded' },
      { _id: 'catalog', writers: [{ name: 'Verified Fictional Writer', share: 100 }], recordings: [{ isrc: 'TEST-ONLY' }] },
    ];
    const initial = structuredClone(songs);
    const indexes: Array<{ name: string; key: Record<string, unknown>; unique: boolean; sparse?: boolean }> = [
      { name: 'url_1', key: { url: 1 }, unique: true },
    ];
    const updateOne = vi.fn((filter, update) => {
      const song = songs.find((item) => item._id === filter._id && item.recordings === undefined);
      if (song) Object.assign(song, update.$set);
      return Promise.resolve({});
    });
    const store: CatalogStore = {
      find: () => ({ toArray: () => Promise.resolve(songs.filter((song) => song.recordings === undefined)) }),
      updateOne,
      indexes: () => Promise.resolve([...indexes]),
      createIndex: vi.fn((_key, options) => { indexes.push({ key: { url: 1 }, ...options }); return Promise.resolve(options.name); }),
      dropIndex: vi.fn((name) => { indexes.splice(indexes.findIndex((index) => index.name === name), 1); return Promise.resolve({}); }),
    };
    const log = vi.fn();
    expect(await migrateSongCatalog(store, false, log)).toEqual({ songs: 2, indexChanges: 2 });
    expect(songs).toEqual(initial);
    expect(store.createIndex).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
    await migrateSongCatalog(store, true, log);
    expect(songs[0]).toEqual({ ...initial[0], recordings: [{ artist: 'Performer', url: 'https://example.invalid/a' }] });
    expect(songs[1].recordings).toEqual([]);
    expect(songs[2]).toEqual(initial[2]);
    expect(await migrateSongCatalog(store, true, log)).toEqual({ songs: 0, indexChanges: 0 });
    expect(updateOne).toHaveBeenCalledTimes(2);
  });

  it('leaves the old uniqueness constraint in place if the replacement index fails', async () => {
    const dropIndex = vi.fn();
    const store = {
      indexes: () => Promise.resolve([{ name: 'url_1', key: { url: 1 }, unique: true }]),
      createIndex: () => Promise.reject(new Error('index failure')), dropIndex,
    } as unknown as CatalogStore;
    await expect(migrateSongCatalog(store, true, () => {})).rejects.toThrow('index failure');
    expect(dropIndex).not.toHaveBeenCalled();
  });

  it('closes its connection even when the database refuses the migration', async () => {
    vi.spyOn(mongoose, 'connect').mockRejectedValue(new Error('connection refused'));
    const close = vi.spyOn(mongoose, 'disconnect').mockResolvedValue(undefined);
    const local = ['mongodb:', '//127.0.0.1:27028/song-catalog-copy'].join('');
    await expect(run([], local)).rejects.toThrow('connection refused');
    expect(close).toHaveBeenCalled();
  });
});

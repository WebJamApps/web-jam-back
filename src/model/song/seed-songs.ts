type Doc = Record<string, unknown>;

// The slice of the song model a seed needs, so tests can inject an in-memory fake.
export interface SongSeedTarget {
  countDocuments(filter: Doc): Promise<number>;
  create(docs: Doc[]): Promise<unknown>;
}

// Writes the built-in songs only into an empty collection; a collection that already holds
// records is left exactly as it is, and nothing here ever deletes (web-jam-back#1146).
export async function seedSongsIfEmpty(target: SongSeedTarget, songs: Doc[]): Promise<string> {
  if (await target.countDocuments({}) > 0) return 'songs left as they are';
  await target.create(songs);
  return 'songs created';
}

export default { seedSongsIfEmpty };

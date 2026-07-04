// Unit tests for scripts/transforms/josh-migration.mjs — the web-jam-tools#897
// ("897a") restore transform. Loaded via a non-literal dynamic `import()` so
// tsc doesn't need a declaration file for this plain .mjs script module (the
// specifier isn't a string literal, so TypeScript treats the result as `any`
// instead of trying to resolve types for it — scripts/ is intentionally
// outside the tsconfig `include` glob, same as scripts/restore-backup.mjs).
type JoshMigrationTransform = (
  doc: Record<string, unknown>,
  collectionName: string,
) => Record<string, unknown> | { collection: string; doc: Record<string, unknown> } | null | undefined;

async function loadTransform(): Promise<JoshMigrationTransform> {
  const modulePath = '../../../scripts/transforms/josh-migration.mjs';
  const mod = await import(modulePath) as { default: JoshMigrationTransform };
  return mod.default;
}

describe('scripts/transforms/josh-migration.mjs', () => {
  describe('gigs', () => {
    it('tags every gig doc with artist: "josh", leaving other fields untouched', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'abc123', venue: 'The Bridge', date: 'Oct 4, 2019' };

      const result = transform(doc, 'gigs');

      expect(result).toEqual({ _id: 'abc123', venue: 'The Bridge', date: 'Oct 4, 2019', artist: 'josh' });
    });

    it('does not mutate the original doc object', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'abc123' };

      transform(doc, 'gigs');

      expect(doc).toEqual({ _id: 'abc123' });
    });
  });

  describe('book', () => {
    it('redirects a JaMmusic-music doc into the jamPics collection, preserving _id and fields', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'book1', type: 'JaMmusic-music', title: 'Valhalla Winery 2019', url: 'https://example.com/x.png' };

      const result = transform(doc, 'book');

      expect(result).toEqual({ collection: 'jamPics', doc });
    });

    it('drops a non-JaMmusic-music doc (returns null)', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'book2', type: 'CollegeLutheran-photo', title: 'Not ours' };

      const result = transform(doc, 'book');

      expect(result).toBeNull();
    });

    it('drops a doc with no type field at all', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'book3', title: 'Untyped' };

      const result = transform(doc, 'book');

      expect(result).toBeNull();
    });
  });

  describe('any other collection', () => {
    it('passes the doc through unchanged (identity)', async () => {
      const transform = await loadTransform();
      const doc = { _id: 'user1', name: 'Someone' };

      const result = transform(doc, 'user');

      expect(result).toBe(doc);
    });
  });
});

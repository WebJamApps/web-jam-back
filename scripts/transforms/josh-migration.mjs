// scripts/transforms/josh-migration.mjs — the web-jam-tools#897 ("897a")
// restore transform: reshapes wj-prod's webjamsocket export on its way into
// web-jam-data.
//
// Plugs into scripts/restore-backup.mjs's --transform seam (see that file's
// header comment and docs/mongo-backup.md for the full contract). This
// module's default export is `(doc, collectionName) => result`, where
// `result` is a plain doc (same collection), `null`/`undefined` (drop the
// doc), or `{ collection, doc }` (redirect the doc to a different
// collection).
//
// Per-collection behavior:
//   - gigs (133 docs in the wj-prod export): web-jam-data has no gigs of its
//     own, so this is a clean move — every doc is tagged `artist: "josh"`
//     (web-jam-data is expected to host more than one artist's gigs
//     eventually; wj-prod only ever tracked Josh's).
//   - book (11 docs, JaMmusic slideshow images): only docs with
//     `type === 'JaMmusic-music'` are kept; everything else is dropped. Kept
//     docs are redirected into a NEW collection, `jamPics` — NOT `book`,
//     because web-jam-data already has its own `book` collection
//     (CollegeLutheran's), which this migration must never touch or clear.
//   - anything else: passed through unchanged (identity), so pointing this
//     transform at an export containing other collections is harmless.
export default function joshMigrationTransform(doc, collectionName) {
  if (collectionName === 'gigs') {
    return { ...doc, artist: 'josh' };
  }
  if (collectionName === 'book') {
    if (doc.type !== 'JaMmusic-music') return null;
    return { collection: 'jamPics', doc };
  }
  return doc;
}

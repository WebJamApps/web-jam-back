# Song catalog rollout

The public `GET /song` response keeps the existing music-page fields: `_id`,
`title`, `artist`, `composer`, `category`, `album`, `year`, `url`, `image`, and
`orderBy`. Only these fields are serialized. Unknown/new database fields remain
private. Queries cannot filter by private rights fields or Mongo operators.
`GET /song/:id` and all writes retain their existing login requirement.

Private catalog fields are `writers` (name and percentage share), `bmiWorkNumber`,
`iswc`, `copyrightRegistration`, and `recordings` (ISRC, release, artist, URL,
year). They remain optional for every category until verified from the relevant
rights source. An original can be catalogued before its splits/registrations are
known; a cover or mission song does not acquire an invented registration or
ownership claim. Neither the display `composer` nor a recording's performer is
converted into a verified writer.

The legacy display fields are retained during the frontend rollout. Songs may
now omit a URL and have an empty recordings list. Existing playback URLs are
copied into recording entries, alongside their existing performer/release/year;
the original fields stay intact. Already populated recordings are untouched.
The existing seed payloads still validate and need no data changes.

## Migration proof on a local copy

Build the script with `npm exec tsc -- -p tsconfig.prod.json`. Restore a database
copy into a local MongoDB instance, with a database name containing a separate
`copy`, `dev`, or `test` component. Set `MONGO_DB_URI` privately to that local
copy. Never point this verification at production.

```sh
npm run migrate:song-catalog
npm run migrate:song-catalog -- --apply
npm run migrate:song-catalog -- --apply
```

The first invocation reports `DRY RUN` and changes no records/indexes. Apply
initializes only missing recordings, preserving rights and all legacy fields.
It creates the sparse unique URL index before dropping the old non-sparse
constraint, so multiple songs without a URL are supported while duplicate URLs
are still refused. The second apply reports zero songs and zero index changes.
An existing recordings list, including an empty list, is never overwritten.

Song's automatic index creation is disabled: this transition is explicit,
never triggered by application startup. The replacement index must be in place
before loading multiple unrecorded songs. This issue verifies the migration on
a disposable copy; any actual deployment/data migration remains a separately
authorized operation. Coordinate the catalog release with the music-page
consumer, JaMmusic's catalog/PDF work, while retaining legacy fields until that
consumer is deployed. No production migration or catalog loading runs here.

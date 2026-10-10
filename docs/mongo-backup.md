# Restoring the MongoDB backup

References: [web-jam-tools#116](https://github.com/WebJamApps/web-jam-tools/issues/116),
[web-jam-tools#1083](https://github.com/WebJamApps/web-jam-tools/issues/1083) (the epic) and the
design document `~/Dropbox/web-jam-llms/backup-restore/mongodb-backup-restore-design-2026-10-07.md`
("Restoring production", "What it refuses to do").

This is the restore runbook. It gives the exact commands to restore a backup run into **DEV** and,
separately, into **production**. Free M0 Atlas keeps no snapshots, so these exports in Dropbox are the
only copies of the data outside the live cluster.

## What a backup run is

One folder per run, named with the run's UTC start time, under `/webjam-backups` in the Dropbox
app `webjam-backup`:

```
2026-10-08T12-00-00-000Z/
  manifest.json              what ran, when, and every collection's record count
  webjamsalem/<collection>.ndjson   one EJSON record per line
```

A run is **good** only when its `manifest.json` exists and says every database exported. A folder
without a manifest is incomplete; a manifest that says a database failed is failed. Only a good run can
be restored. The newest 8 good runs are kept.

On the laptop the run folders sync to `~/Dropbox/Apps/webjam-backup/webjam-backups/`, which is where
the script reads them. The backend reads and writes the same folder through the three settings
`BACKUP_DROPBOX_APP_KEY`, `BACKUP_DROPBOX_APP_SECRET` and `BACKUP_DROPBOX_REFRESH_TOKEN`; a backend
missing any of them refuses to back up or restore.

## What a restore does

A restore is a **replacement, not a merge**. For every collection in the chosen run it drops the
collection and re-creates it from the run's file, then rebuilds the indexes the record definitions
(the Mongoose schemas) declare. Whatever was written after the chosen run is gone from the restored
collections.

- Collections that are **not** in the run are left alone.
- Role assignments are part of the data: who holds `Developer` is restored along with everything else.
- Indexes made by hand outside the code are **not** re-created; the result lists every index that
  existed before the restore and is missing after.
- The site keeps running during a restore and serves a collection as empty for the moment it is replaced.

Both the production route and the command-line script call one module,
`src/model/backup/backup-restore.ts`.

## Restore into DEV (the normal drill)

DEV is disposable, so this is the safe way to test a backup. `.env` in `~/WebJamApps/web-jam-back`
points `MONGO_DB_URI` at the DEV Atlas database (its name contains `dev`).

1. Pick a good run folder, for example
   `~/Dropbox/Apps/webjam-backup/webjam-backups/2026-10-08T12-00-00-000Z`. Open its `manifest.json`
   and confirm each database says `"ok": true`.
2. Build the compiled module the script imports:

   ```sh
   cd ~/WebJamApps/web-jam-back
   npx tsc -p tsconfig.prod.json
   ```

3. Run the restore:

   ```sh
   node scripts/restore-backup.mjs \
     --folder ~/Dropbox/Apps/webjam-backup/webjam-backups/2026-10-08T12-00-00-000Z \
     --db webjamsalem
   ```

4. The script first checks each file's record count against `manifest.json`; any difference stops it
   with nothing changed. Then it prints, per collection, the count restored beside the count in the
   manifest, and lists any index that was present before and is missing after. The two counts must be
   equal.
5. Start the app against that database (`npm run dev`) and request a real route, for example
   `curl http://localhost:7000/song`, to confirm the restored data serves.

The script refuses any database whose name contains neither `dev` nor `test` (and is not
`localhost`/`127.0.0.1`) unless `--force` is given. Options: `--folder` (required), `--db`
(default `webjamsalem`), `--uri` (default `MONGO_DB_URI`), `--transform`, `--force`.

## Copy production into DEV (from the admin API)

The production backend can put a chosen good run into the DEV database with every email address
replaced, so DEV has realistic data that can never email a real person. It reads only the run's
files from Dropbox; production is not touched.

Setting on `webjamsalem`: `DEV_MONGO_DB_URI`, the address of the DEV database with the login that
covers that database only.

```sh
curl -X POST --oauth2-bearer "$TOKEN" https://webjamsalem.herokuapp.com/admin/backup/runs/RUN_NAME/copy-to-dev
curl --oauth2-bearer "$TOKEN" https://webjamsalem.herokuapp.com/admin/backup/operations/OPERATION_NAME
```

It answers `202` with a `copy-to-dev-<time>` name; the operations route then reports
`status: completed` with the per-collection counts copied beside the manifest counts, the addresses
replaced per collection, and the read-back, or `status: failed` with the refusal.

It refuses (nothing changed) when `DEV_MONGO_DB_URI` is absent or unparseable; when its database name
does not contain `dev` or cannot be determined; when its host is production's or production's host
cannot be determined; when the DEV cluster cannot be reached (a Free cluster pauses after 30 days;
`Resume` for the DEV cluster on the Atlas website wakes it); and when the run is not good or a file's
record count differs from the manifest.

On the way in: every email address, in every collection and every text value, becomes
`<collection>-<record id>@example.invalid`; accounts holding the `Developer` role keep their own
`email`; Facebook token values are emptied and the records kept. The read-back scans every DEV
collection and reports any remaining real address other than those accounts' own. A copy is clean
only when `clean` is `true`.

## Restore into production

A production restore replaces the live data. It is a deliberate act with four guards, and the first
thing it does is take a fresh backup of production as it stands, so what you are about to overwrite
survives in that backup.

### From the admin page or the API (the normal way)

Only an account holding the top-level admin role (`Developer`) can do this. The button on the
database page calls this route; the same call by hand:

1. List the runs, newest first, and pick a good one (`"state": "good"`):

   ```sh
   curl --oauth2-bearer "$TOKEN" https://webjamsalem.herokuapp.com/admin/backup/runs
   ```

2. Start the restore. `date` is the chosen run's date, typed as `YYYY-MM-DD` (UTC):

   ```sh
   curl -X POST --oauth2-bearer "$TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"date": "2026-10-08"}' \
     https://webjamsalem.herokuapp.com/admin/backup/runs/2026-10-08T12-00-00-000Z/restore
   ```

   It answers `202` at once with `{"name": "restore-<time>", "message": "restore started"}`.

3. Follow it with the name it returned until `status` is `completed` or `failed`:

   ```sh
   curl --oauth2-bearer "$TOKEN" https://webjamsalem.herokuapp.com/admin/backup/operations/restore-<time>
   ```

   `progress` names the step it is on. When `completed`, `result.collections` holds, per collection,
   `restored` beside `manifest` (they must be equal), `result.missingIndexes` lists any index that
   was present before and is missing after, and `result.indexFailures` lists any declared index that
   could not be built (the data is restored either way).

The four guards, checked in the order below. A refusal leaves `status: failed` with an `error` that names the guard, and
**nothing is changed**:

| Guard | Refuses when |
|---|---|
| 1. Choose a good run | the run has no manifest, a failed manifest, or its manifest cannot be read |
| 2. Type its date | the typed date differs from the run's date, or the run's date cannot be determined |
| 4. The files are checked | a file is missing or cannot be downloaded, or a file's record count differs from the manifest |
| 3. A fresh backup first | the fresh backup of production fails, or cannot be read back as a good run |

The run's files are downloaded and counted before the fresh backup is taken, because the fresh backup
prunes to the newest 8 good runs and could otherwise delete the oldest run you just chose. Only one
restore runs at a time; a second answers `409`, as does starting a restore while a backup is running.

### From the laptop (when the backend is down)

This is the disaster-recovery path and has **no typed date and no fresh backup**, so do those by hand.

1. If the backend is up, take a fresh backup and wait for it to be good:

   ```sh
   curl -X POST --oauth2-bearer "$TOKEN" https://webjamsalem.herokuapp.com/admin/backup/runs
   ```

2. Build, then restore with `--force`, which is what allows a database whose name has neither `dev`
   nor `test`. Keep the production connection string out of shell history: set `PROD_MONGO_URI` from
   KeePass first.

   ```sh
   cd ~/WebJamApps/web-jam-back
   npx tsc -p tsconfig.prod.json
   node scripts/restore-backup.mjs \
     --folder ~/Dropbox/Apps/webjam-backup/webjam-backups/2026-10-08T12-00-00-000Z \
     --db webjamsalem \
     --uri "$PROD_MONGO_URI" \
     --force
   ```

3. Check that every restored count equals the manifest count, read the missing-index list, and open
   the site.

## Parameterization (reused by web-jam-tools#897)

The script was reused, unchanged, as the import half of the wj-prod → web-jam-data migration
(web-jam-tools#897). `--uri` points the restore at any Mongo connection string and `--db` selects
which exported subfolder to restore. `--transform <path-to-module>` is an optional per-record hook: the
module's default export, `(doc, collectionName) => result`, runs on every document before it is
inserted, and `result` is one of:

- a plain document — inserted into the **same** collection (what no `--transform` does);
- `null` / `undefined` — the document is **dropped**;
- `{ collection, doc }` — the document is **redirected** into `collection`.

A collection is only dropped if at least one document resolves to it, so a collection entirely
redirected or dropped by a transform is never touched. The implementation of #897 is
`scripts/transforms/josh-migration.mjs`, tested in `test/unit/backup/josh-migration.spec.ts`:

```sh
node scripts/restore-backup.mjs \
  --folder <run-folder> --db webjamsocket \
  --uri "<dev-or-test web-jam-data Mongo URI>" \
  --transform scripts/transforms/josh-migration.mjs
```

## Making a backup

The backend backs itself up: a check at start-up and every hour starts a run when the newest good run
is more than 24 hours old, and `POST /admin/backup/runs` (or the older `POST /admin/backup`) starts
one on demand. Each failed run emails the `Developer` accounts. `GET /backup/status` reports the
newest good run's start time and whether the most recent run failed.

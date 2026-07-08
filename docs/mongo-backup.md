# Weekly Mongo backup (Dropbox)

Reference: [web-jam-tools#116](https://github.com/WebJamApps/web-jam-tools/issues/116).

## TL;DR

`POST /admin/backup` exports every collection of this app's own database as
EJSON and uploads them to Dropbox, keeping the newest 8 weekly runs. Free M0
Atlas has no snapshots/PITR, so this self-export is the only safety net.
Triggered weekly by the Deno cron app (`web-jam-tools`, same pattern as
`/outreach/advance`) — that half is a separate PR in that repo.

- One DB exported: **webjamsalem** (this app's own `MONGO_DB_URI`, the
  web-jam-data database — gigs live here too as an artist-scoped collection
  since web-jam-back#897 retired the old WebJamSocketCluster mirror connection
  and its `GIGS_MONGO_DB_URI` var).
- Responds **202 immediately**; the export + upload run async so the request
  never rides Heroku's 30s router timeout (H12).
- Exports collection-by-collection (one collection's documents in memory at a
  time).
- EJSON preserves data + types (ObjectId/Date/etc.) but **not** indexes or
  collection options — Mongoose re-creates indexes on the app's next boot.

## One-time manual setup

### 1. Create the Dropbox app (Josh)

1. <https://www.dropbox.com/developers/apps> → **Create app** → Scoped access →
   **App folder** access type (simplest — the app only ever writes under its own
   `/webjam-backups` folder) → name it e.g. `webjam-backup`.
2. **Permissions** tab → enable `files.content.write` and `files.content.read` →
   **Submit**.
3. **Settings** tab → note the **App key** and **App secret**. Save both in
   KeePass.
4. Generate a refresh token (one-time, from a machine with a browser):
   - Visit (replace `<APP_KEY>`):
     `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&token_access_type=offline&response_type=code`
   - Approve access; copy the **authorization code** shown.
   - Exchange it for a refresh token:
     ```sh
     curl https://api.dropboxapi.com/oauth2/token \
       -d code=<AUTH_CODE> \
       -d grant_type=authorization_code \
       -d client_id=<APP_KEY> \
       -d client_secret=<APP_SECRET>
     ```
   - The response's `refresh_token` **does not expire** (until revoked) — that's
     why this flow is used instead of a deprecated long-lived token. Save it in
     KeePass.

### 2. Set the config vars on `webjamsalem`

```sh
heroku config:set DROPBOX_APP_KEY="<app key>" -a webjamsalem
heroku config:set DROPBOX_APP_SECRET="<app secret>" -a webjamsalem
heroku config:set DROPBOX_REFRESH_TOKEN="<refresh token>" -a webjamsalem
```

### Environment variables

| Var | Purpose | Without it |
| --- | --- | --- |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` / `DROPBOX_REFRESH_TOKEN` | Dropbox refresh-token flow | Export still runs, upload is skipped (local disk only) |
| `BACKUP_OUTPUT_DIR` | Optional override for the local export scratch dir (default: OS tmpdir) | n/a |
| `BACKUP_KEEP_LOCAL` | Set to `true` to keep the local export after a successful Dropbox upload (debugging) | Local export is deleted once safely in Dropbox |

## Auth

Guarded exactly like `POST /outreach/advance`: `authUtils.ensureAuthenticated`
via `routeUtils.makeAction`, mounted at `/admin/backup` so it's gated on
`AUTH_ROLES.admin` (same key as `/admin/user`, `/admin/subscriber` — no new auth
mechanism). The Deno cron calls it with a no-expiry **service JWT**
(`createServiceJWT` — mint one via `POST /admin/user/:id/token` for an admin
user, same as any other cron caller).

## Retention

After a successful upload, the job lists `/webjam-backups`' subfolders and
deletes every one beyond the newest 8 (`src/lib/dropbox.ts`'s `foldersToPrune`).
Dropbox's own version history covers recovering something pruned by mistake.

## Restoring

`scripts/restore-backup.mjs` restores one dated export folder's `<db>/*.ndjson`
files back into a target Mongo database — **dropping** each target collection
first (a restore is a replace, not a merge) and reinserting every exported
document, then printing per-collection counts.

```sh
node scripts/restore-backup.mjs --folder <path/to/run-folder> --db webjamsalem
```

- `--uri` defaults to `MONGO_DB_URI` from `.env` — **the DEV Atlas cluster**
  locally (never prod; see the local-dev-uses-dev-atlas convention). Dev is
  disposable by design, so restoring into it is the normal, safe drill target.
- The script refuses to run against anything that doesn't look like
  local/dev/test unless `--force` is passed (mirrors `scripts/seed-outreach.mjs`'s
  guard) — a real disaster-recovery restore into prod is a deliberate act, never
  an accidental default.
- **Mongoose re-creates indexes on the app's next boot** — after restoring, run
  `npm run dev` (or `npm start`) against that database to confirm indexes come
  back and the app actually serves real data.

### Parameterization (reused by web-jam-tools#897)

This same script was reused, unchanged, as the import half of the wj-prod →
web-jam-data migration (web-jam-tools#897, now complete — the mirror
connection and `GIGS_MONGO_DB_URI` it used to feed have since been retired)
— not just this issue's local/dev backup drill. It stays generic/reusable for
any future one-off migration:

- **Target database is already parameterized**, never hardcoded: `--uri`
  points the restore at any Mongo connection string, and `--db` selects which
  exported subfolder to restore. #897 passed its own `--uri`/`--db` rather than
  needing a fork of this script.
- **`--transform <path-to-module>`** is an optional per-record hook: the
  module's default export, `(doc, collectionName) => result`, runs on every
  document immediately after `EJSON.parse` and before `insertMany`. `result`
  is one of:
  - a plain document object — inserted into the **same** collection as the
    source file (this is what the default identity passthrough returns, so a
    plain #116 restore is unaffected).
  - `null` / `undefined` — the document is **dropped** (not inserted
    anywhere).
  - `{ collection, doc }` — the document is **redirected**: `doc` is inserted
    into `collection` instead of the source file's collection name.

  A source collection is only dropped-and-reinserted in the target database if
  at least one document actually resolves to it, so a collection that's
  entirely redirected/dropped by a transform is never touched in the target
  (see `scripts/transforms/josh-migration.mjs` below).

  #897's implementation lives in `scripts/transforms/josh-migration.mjs`:
  every `gigs` doc gets `artist: "josh"` added (same collection); every `book`
  doc is kept only if `type === 'JaMmusic-music'` and, if kept, redirected into
  a **new** `jamPics` collection — not `book`, since web-jam-data already has
  its own `book` collection (CollegeLutheran's) that this migration must never
  touch. Non-kept `book` docs are dropped. Unit tests for this module live at
  `test/unit/backup/josh-migration.spec.ts`.

  Example invocation (into a DEV/TEST `web-jam-data` target only — the safety
  guard above still applies, and this step is never run with `--force`):

  ```sh
  node scripts/restore-backup.mjs \
    --folder <run-folder> --db webjamsocket \
    --uri "<dev-or-test web-jam-data Mongo URI>" \
    --transform scripts/transforms/josh-migration.mjs
  ```

### End-to-end restore drill

1. Trigger a real backup (or run the export directly for a local drill —
   `DROPBOX_*` unset skips the upload and leaves the export on local disk at
   `BACKUP_OUTPUT_DIR`, default the OS tmpdir).
2. `node scripts/restore-backup.mjs --folder <run-folder> --db webjamsalem`
   — confirm the printed per-collection counts match that run's `manifest.json`.
3. `npm run dev` (or `npm start`) against that same `MONGO_DB_URI` and hit a real
   route (e.g. `curl http://localhost:7000/song`) — confirms the restored data
   actually serves, not just that the counts matched.

The **real** drill (restoring an actual prod export) happens post-deploy, before
[web-jam-tools#116](https://github.com/WebJamApps/web-jam-tools/issues/116) is
closed by the companion cron PR in that repo.

## Triggering

Not yet wired to a schedule from this repo's side — the Deno cron app
(`web-jam-tools`, PR follows this one) pings `POST /admin/backup` weekly, the
same way it already pings `/outreach/advance` daily. Until then, trigger it
manually with a service token:

```sh
curl -X POST https://webjamsalem.herokuapp.com/admin/backup \
  -H "Authorization: Bearer <service JWT>"
```

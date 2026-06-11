# web-jam-back

[![CircleCI](https://circleci.com/gh/WebJamApps/web-jam-back.svg?style=svg)](https://circleci.com/gh/WebJamApps/web-jam-back)
[![Known Vulnerabilities](https://snyk.io/test/github/webjamapps/web-jam-back/badge.svg)](https://snyk.io/test/github/webjamapps/web-jam-back)

This repository is used for the following apps:

- [Web Jam LLC](https://www.web-jam.com)
- [collegelutheran.org](https://www.collegelutheran.org)
- [joshandmariamusic.com](http://joshandmariamusic.com)

## Install

- clone this repo
- `npm install` (JaMmusic build should fail)
- Request a copy of the .env file, which includes credentials to dev & test mongodbs and to connect to the Google auth service. You will need to put a copy of the .env file into the root of the backend folder and also inside of backendroot/frontend so that you can test the production build from the local backend.

After placing the new .env file into the web-jam-back/frontend folder, you need to rebuild so that these environment variables are used in the output to dist, so just run `npm install` again.

## Run the server

**`npm start`** starts the express server at localhost:7000.

**`npm run start:debug`** also starts the node debugger, which allows you to use Chrome browser to debug. You should also install the NIM add-on to Chrome and set it to automatic mode.

## Authorization

The .env contains a variable that points to the localhost of the front end and other required credentials.

## Email (`/inquiry` route)

The `/inquiry` route sends a booking-inquiry email via Gmail SMTP using `nodemailer`. As of 2026-05-17 this replaces the previous `@sendgrid/mail` integration (see [docs/inquiry-sendgrid-crash.md](docs/inquiry-sendgrid-crash.md) for the post-mortem on the SendGrid failure mode that motivated the swap).

Two env vars must be set on the deployed environment (and in your local `.env` for end-to-end testing):

- `GMAIL_USER` — the Gmail address used to authenticate and as the `From` address. Production value: `joshua.v.sherman@gmail.com`.
- `GMAIL_APP_PASSWORD` — a Gmail App Password (NOT the regular account password). To generate one:
  1. Sign in to the Google account at <https://myaccount.google.com>.
  2. Security → 2-Step Verification (must be ON; App Passwords are unavailable without it).
  3. App passwords → choose "Mail" and a device label like "web-jam-back".
  4. Copy the 16-character password Google shows. Store it as `GMAIL_APP_PASSWORD` in `.env` locally and as a Heroku config var in production.

The destination address (`To`) is hardcoded to `joshua.v.sherman@gmail.com` in `src/model/inquiry/InquiryController.ts`. Change there if you need a different recipient.

In `NODE_ENV=test` the route returns 200 without actually sending email, so unit tests don't require live credentials.

### Setting the env vars on Heroku

Replace `<your-heroku-app-name>` with the actual app name (find it in the Heroku dashboard or via `heroku apps`).

**Option A — Heroku CLI (recommended):**

```bash
# Set the new values. The 16-character App Password from Google has no spaces; quote it to be safe.
heroku config:set GMAIL_USER=joshua.v.sherman@gmail.com -a <your-heroku-app-name>
heroku config:set GMAIL_APP_PASSWORD='xxxx xxxx xxxx xxxx' -a <your-heroku-app-name>

# Verify the values are set (do NOT paste the password output into a public channel):
heroku config:get GMAIL_USER -a <your-heroku-app-name>
heroku config:get GMAIL_APP_PASSWORD -a <your-heroku-app-name>

# Tail logs while sending a test inquiry from the live site:
heroku logs --tail -a <your-heroku-app-name>

# AFTER verifying the test inquiry arrived in the inbox, remove the obsolete SendGrid vars:
heroku config:unset SENDGRID_API_KEY -a <your-heroku-app-name>
heroku config:unset SENDGRID_USERNAME -a <your-heroku-app-name>
heroku config:unset SENDGRID_PASSWORD -a <your-heroku-app-name>
```

Setting a config var triggers a Heroku dyno restart automatically. The change is live as soon as the new dyno is up (usually within ~30 seconds).

**Option B — Heroku dashboard:**

1. Log in to <https://dashboard.heroku.com>.
2. Select the web-jam-back app.
3. Settings → Reveal Config Vars.
4. Add `GMAIL_USER` = `joshua.v.sherman@gmail.com`.
5. Add `GMAIL_APP_PASSWORD` = the 16-character password from Google.
6. Send a test inquiry from the live site, confirm it arrives at `joshua.v.sherman@gmail.com`.
7. ONLY after delivery is confirmed, remove `SENDGRID_API_KEY`, `SENDGRID_USERNAME`, `SENDGRID_PASSWORD` from the same Config Vars page (click the X next to each).

## Livestream (`/livestream/current` route)

`GET /livestream/current` powers the CollegeLutheran livestream page's "always show a real video" behavior (CollegeLutheran#706). It queries the YouTube Data API v3 and returns:

- `{ "videoId": "…", "status": "live" }` — the channel is live right now
- `{ "videoId": "…", "status": "completed" }` — otherwise, the most recent finished stream
- `{ "videoId": null, "status": "none" }` — on error, nothing found, or when the API key/channel are not configured (the UI then falls back to plain links)

The result is cached in-memory for 15 minutes, because each YouTube `search.list` call costs 100 of the free 10,000-units/day quota.

Two env vars must be set on the deployed environment (and in your local `.env` for end-to-end testing):

- `YOUTUBE_API_KEY` — a YouTube Data API v3 key from the Google Cloud Console (Web Jam LLC project), restricted to the YouTube Data API v3. **Secret — server-side only**, never exposed to the browser (that's the whole reason this lives in the backend).
- `YOUTUBE_CHANNEL_ID` — the channel to watch. College Lutheran: `UCOra1rXiO-BHzMDNlLd9hFQ` (public).

Without these, the endpoint returns `none` and the page shows its fallback links, so it is safe to deploy before they are set. In `NODE_ENV=test` no real API calls are made (tests stub `fetch`).

### Setting the env vars on Heroku (app: `webjamsalem`)

**Option A — Heroku dashboard (recommended):**

1. Log in to <https://dashboard.heroku.com> and select the `webjamsalem` app.
2. Settings → Reveal Config Vars.
3. Add `YOUTUBE_API_KEY` = the key from Google Cloud Console.
4. Add `YOUTUBE_CHANNEL_ID` = `UCOra1rXiO-BHzMDNlLd9hFQ`.

**Option B — Heroku CLI:**

```bash
heroku config:set YOUTUBE_API_KEY='<your-key>' -a webjamsalem
heroku config:set YOUTUBE_CHANNEL_ID=UCOra1rXiO-BHzMDNlLd9hFQ -a webjamsalem
heroku config:get YOUTUBE_CHANNEL_ID -a webjamsalem   # verify (do NOT echo the key)
```

Setting a config var triggers a dyno restart automatically; the change is live within ~30 seconds.

## Facebook feed (`/facebook/*` routes)

Powers the CollegeLutheran and WebJamLLC homepage Facebook feeds (CollegeLutheran#740 / web-jam-back#797, multi-page web-jam-back#799), replacing the unreliable Page Plugin iframe. Multiple pages share one Meta app; each page has its own stored token and its own in-memory cache, keyed by `pageId`.

- **`GET /facebook/feed?pageId=<id>`** — public, no auth. Returns `{ posts, lastUpdated }` from that page's in-memory cache, refreshed on startup and then hourly. With no `pageId` it defaults to the CollegeLutheran page (`FB_PAGE_ID`) so the already-deployed CLC frontend keeps working until it passes the param. Empty (`{ "posts": [], "lastUpdated": null }`) until that page's token has been set, so it is safe to deploy before configuring anything; the UI falls back to a plain Facebook link.
- **`PUT /facebook/token`** — admin only (guarded by `AUTH_ROLES.facebook`). Body `{ "userToken": "<short-lived FB user token>", "pageId": "<id>" }` from the admin page's "Reconnect Facebook" button. `pageId` selects which page is being reconnected (defaults to the CLC page for back-compat). The server exchanges the user token for a long-lived one, reads that page's token from `/me/accounts`, stores it in MongoDB (one `FacebookToken` doc per `pageId`), and refreshes that page's cache. The app secret never leaves the server, which is why the exchange can't happen in the browser.

When a page token dies (Graph OAuth `code 190` — e.g. Josh changed his Facebook password, logged out of all sessions, or hit a security checkpoint), the server emails `GMAIL_USER` **once per page per outage**, naming the page that died, telling him to click Reconnect Facebook. The flag re-arms on that page's next healthy refresh; Heroku's ~daily dyno restart also resets it, so a dead token re-nags about once a day until fixed (intentional). The last good cache keeps serving throughout, so the feed just stops updating rather than breaking.

The single-page era stored one token doc keyed `key: 'pageToken'`. On startup the service migrates that doc to the CLC `pageId` (and drops the stale `key_1` unique index) so CollegeLutheran survives the multi-page deploy without a manual reconnect.

**Graph API version:** pinned in one constant (`FB_GRAPH_VERSION` in `FacebookController.ts`). Meta supports each version for at least 2 years; expired versions don't hard-fail (calls auto-forward to the oldest still-supported version), and the four fields used (`message`, `full_picture`, `permalink_url`, `created_time`) are stable core fields. Bump the constant when convenient — no scheduled maintenance needed.

Env vars (set on the deployed environment and in your local `.env` for end-to-end testing):

- `FB_APP_ID` / `FB_APP_SECRET` — the "Web Jam LLC" Meta app (Josh is app admin; the app stays in development mode, so no Meta app review is needed). **`FB_APP_SECRET` is secret — server-side only.**
- `FB_PAGE_ID` — the back-compat default page id served when `?pageId` is omitted: the CollegeLutheran page `202368653220334`.
- `FB_PAGES` — a JSON `pageId` → display-name map of every page served, e.g. `{"202368653220334":"CollegeLutheran","365007513885497":"WebJamLLC"}`. Drives the hourly refresh loop and the page name used in the dead-token alert email. If unset, the service falls back to the single `FB_PAGE_ID` (CollegeLutheran only).
- `AUTH_ROLES` — add a `"facebook": ["Developer", "clc-admin", "JaM-admin"]` entry (the CLC and JaM admins, plus Developer). Any of these can reconnect any page. Without the entry, any authenticated user could update a token.
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` — already used by the `/inquiry` route; reused for the token-death alert. In `NODE_ENV=test` no email is sent and no Graph calls are made.

Set these the same way as the Livestream vars above (Heroku dashboard Config Vars or `heroku config:set ... -a webjamsalem`).

### Which Facebook var lives where (across all repos)

There are really only four things; most "vars" just point at them. **Page access tokens are never env vars** — the backend derives them on reconnect and stores them in MongoDB, one per `pageId`.

| Var | Repo(s) | Public / secret | Purpose |
|-----|---------|-----------------|---------|
| `FB_APP_ID` (`2207148322688942`, "Web Jam LLC" app) | web-jam-back **and** each frontend (JaMmusic, CollegeLutheran) at **build** time | **Public** — safe in the browser bundle | Identifies the Meta app; opens the FB login popup (frontends) and authorizes the token exchange (backend) |
| `FB_APP_SECRET` | web-jam-back **only** | **Secret** | Server-side token exchange; must never reach a frontend |
| `FB_PAGE_ID` | web-jam-back only | Public id | Default page when `GET /facebook/feed` omits `?pageId` (CollegeLutheran) |
| `FB_PAGES` | web-jam-back only | Public ids | `pageId`→name map of every page served; drives the refresh loop + alert email name |
| `AUTH_ROLES.facebook` | web-jam-back only | — | Roles allowed to `PUT /facebook/token` |

Frontends need only two things: `FB_APP_ID` (build-injected) and the **page id** they show (JaMmusic hardcodes WebJamLLC's `365007513885497`; CollegeLutheran uses the backend default). Locally each repo sets its own `.env`; in production the backend vars live on the web-jam-back Heroku app(s), and `FB_APP_ID` must also be present at the frontend's **build** step (the web-jam-back app that compiles the frontend injects it).

### Reconnecting a feed — check BOTH pages

The Reconnect flow logs the page admin into Facebook, where the consent dialog lists the pages you manage. **That selection is a replace, not an add:** if you uncheck a page you previously granted, Facebook *revokes* the app's access to it and its stored token dies. So whenever you log in to reconnect *either* feed, **leave both the CollegeLutheran and WebJamLLC pages checked.** (Forgetting to check the page you're actually reconnecting just fails harmlessly with "page not found".)

### Finding / verifying a page id

The id stored in `FB_PAGES` must be the one Facebook returns from `/me/accounts` (that's what the token exchange matches against). To find or confirm it: in the [Graph API Explorer](https://developers.facebook.com/tools/explorer) generate a user token (scope `pages_show_list`, the page checked), then `GET /v20.0/me/accounts` and read the `id` next to the page name. A quick sanity check: `https://www.facebook.com/<page-id>` should land on that page. The page's HTML `delegatePageID` is **not** reliable — it can differ from the Graph id under the New Pages Experience.

### One-time Meta app dashboard setup

These live in the **Web Jam LLC** Meta app (developers.facebook.com), not in code or env. The app stays in **Development mode** (no app review needed), which has consequences below.

- **Allowed Domains for the JavaScript SDK** (Facebook Login → Settings) — every host that runs the SDK's `FB.login` must be listed, or the browser throws *"JSSDK Unknown Host domain"*. Add the same list under **Settings → Basic → App Domains**, and set **"Login with the JavaScript SDK" = Yes**. The full list across both apps and all environments:

  ```
  localhost                      # local dev for both apps (host only — ports ignored)
  web-jam.com                    # production host both apps actually serve under (APP_NAME)
  www.web-jam.com
  joshandmariamusic.com          # JaMmusic vanity domain
  www.joshandmariamusic.com
  collegelutheran.org            # CollegeLutheran vanity domain
  www.collegelutheran.org
  ```

- **Who can use "Reconnect Facebook":** because the app is in Development mode, only users with a **role on the app** (Admin / Developer / Tester) can complete `FB.login`. To let someone reconnect their own page (e.g. the CLC admin), add them under **App Roles → Roles → Testers**; they must also be an admin of that Facebook page.
- **Consent dialog reuse:** `FB.login` is called with `auth_type: 'rerequest'` so the page picker shows every time. Without it Facebook offers *"continue with previous settings"* and silently reuses the last grant — which is how reconnecting one page can leave the other ungranted and 400 the next exchange (`page not found in /me/accounts`). Still **keep both pages checked** each time (see "Reconnecting a feed" above).

## Test

**`npm test`** runs the tests and generates a coverage report.

if some tests fail it is probably due to the TEST database instance of MongoDb Atlas needs to be resumed.

## Git

To get the latest version of code, **`git pull origin dev`**, create your own branch, then switch to your own branch. Push code changes to your own branch and then submit a pull request to the **dev** branch on GitHub.

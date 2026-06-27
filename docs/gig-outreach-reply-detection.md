# Gig-outreach reply-detection (Gmail IMAP + Haiku)

Reference: issue [#825](https://github.com/WebJamApps/web-jam-back/issues/825),
backend PR [#875](https://github.com/WebJamApps/web-jam-back/pull/875). Part of the
gig-outreach epic [#818](https://github.com/WebJamApps/web-jam-back/issues/818).

## TL;DR

When a venue replies to a booking pitch, the system detects it over **Gmail IMAP**
(matched precisely by the pitch's RFC `Message-ID`), moves the outreach record to
`replied` — which **halts the follow-up cadence** — stores a snippet of the reply,
and asks **Claude Haiku** to *suggest* a venue status update for Josh to
approve/edit/dismiss. **The AI never writes venue data on its own.**

The feature is **dormant until the env vars below are set**; with them unset every
piece is a safe no-op (no detection, no AI call).

## One-time manual setup

All on the **same Gmail account that sends the pitches** (`GMAIL_USER`, currently
`joshua.v.sherman@gmail.com`) — replies land in that mailbox.

1. **IMAP** — already on for personal Gmail (Google removed the enable/disable
   toggle; the POP/IMAP settings page just shows behaviour options). Nothing to do.
2. **2-Step Verification** must be on (required for app passwords):
   <https://myaccount.google.com/signinoptions/twosv>.
3. **Gmail app password** — <https://myaccount.google.com/apppasswords> → name it
   `webjam-outreach-imap` → **Create** → copy the 16-character value and **remove
   the spaces**. Save it in KeePass (shown once).
4. **Anthropic API key** (paid — needs ≥ $5 of usage credits;
   classification cost is a fraction of a cent per reply) —
   <https://console.anthropic.com/settings/keys> → **Create Key** →
   `webjam-outreach-haiku`. Save it in KeePass.
5. **Set the config vars on `webjamsalem`** (each `set` restarts the dyno):

   ```sh
   heroku config:set GMAIL_IMAP_USER="joshua.v.sherman@gmail.com" -a webjamsalem
   heroku config:set GMAIL_IMAP_APP_PASSWORD="<16 chars, no spaces>" -a webjamsalem
   heroku config:set ANTHROPIC_API_KEY="sk-ant-..." -a webjamsalem
   ```

### Environment variables

| Var | Purpose | Without it |
| --- | --- | --- |
| `GMAIL_IMAP_USER` | Gmail account to read replies from | IMAP scan is skipped (no detection) |
| `GMAIL_IMAP_APP_PASSWORD` | Gmail app password for IMAP | IMAP scan is skipped (no detection) |
| `ANTHROPIC_API_KEY` | Claude Haiku reply classification | replies still detected + cadence halted, but no AI suggestion attached |

IMAP is used deliberately instead of the Gmail API: `gmail.metadata`/`readonly` are
Google *restricted* scopes that would force a CASA security assessment on the
published OAuth app. An app password is a separate auth path that sidesteps it.

## Endpoints

| Route | Cap | What it does |
| --- | --- | --- |
| `POST /outreach/check-replies` | `outreach:edit` | IMAP scan; matched replies → `replied` (halts cadence) + snippet + Haiku suggestion. Returns `{ checked, matched, classified }`. |
| `GET /outreach/replies/pending` | any `outreach:*` | The "replies to review" queue: replied records with an unreviewed suggestion. |
| `POST /outreach/:id/apply-suggestion` | `venue:edit` | Josh approves/edits/dismisses/re-opens. Default: writes the venue's `bookingStatus`/`interested` (edited body values win over the AI's), marks the suggestion reviewed. `{ "dismiss": true }` reviews without writing. `{ "reopen": true }` reverts a **false-positive** back to `sent` (cadence resumes) — for when a detected "reply" wasn't a real venue reply. **Apply is the only path that turns a suggestion into a venue write.** |

## Avoiding false matches

Every pitch CCs Josh, so a copy of the pitch lands in the IMAP mailbox. A naive
"references this Message-ID" search matches that copy and would mark the venue
`replied` off its own outgoing mail. `findReplies` guards against it: a candidate
is dropped unless it is **not** our own pitch/CC copy (its `Message-ID` isn't one
of ours and its `From` isn't our sending address) **and** it actually references
one of our pitches (`References`/`In-Reply-To`). The snippet is taken from the
message **body** (after the header block), never the raw headers. If one ever
slips through, the `reopen` action above puts the venue back into the cadence.

## The 30-second constraint

`check-replies` runs inside a single Heroku web request, which has a hard **30s
router timeout (H12)**. To stay under it, `findReplies` (`src/lib/imap-replies.ts`):

- bounds every IMAP search with `SINCE` the earliest active pitch date (Gmail
  scans only recent mail, not all-time over All Mail), and
- races the whole scan against a **25s internal deadline**, returning whatever
  matched so far if Gmail is slow (the next tick re-scans the rest).

## Triggering & the cron

Reply-detection is **not yet wired into the daily cron** — the Deno Cron
([#100](https://github.com/WebJamApps/web-jam-tools/issues/100), in `web-jam-tools`)
currently only hits `/outreach/advance`. Until it also calls `/outreach/check-replies`,
run a scan manually (service token at `~/WebJamApps/web-jam-llms/web-jam-llm.token`):

```sh
TOKEN=$(cat ~/WebJamApps/web-jam-llms/web-jam-llm.token)
curl -s -X POST https://webjamsalem.herokuapp.com/outreach/check-replies \
  -H "Authorization: Bearer $TOKEN"
curl -s https://webjamsalem.herokuapp.com/outreach/replies/pending \
  -H "Authorization: Bearer $TOKEN"
```

## Remaining for #825

The JaMmusic AdminVenues "Replies to review" UI (consumes `replies/pending` +
`apply-suggestion`) closes the issue.

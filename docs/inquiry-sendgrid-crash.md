# `/inquiry` SendGrid crash — local vs production behavior

Reference: issue [#747](https://github.com/WebJamApps/web-jam-back/issues/747), PR [#748](https://github.com/WebJamApps/web-jam-back/pull/748).

**Update 2026-05-17:** SendGrid was removed entirely in issue [#752](https://github.com/WebJamApps/web-jam-back/issues/752) (Phase 3 of [#749](https://github.com/WebJamApps/web-jam-back/issues/749)). The `/inquiry` route now sends via Gmail SMTP through `nodemailer`. The post-mortem below is preserved as historical context for the SendGrid-era failure mode. See the [README "Email" section](../README.md) for the current setup.

## TL;DR

A latent unhandled-rejection bug in the `/inquiry` route was crashing the
Node process whenever `@sendgrid/mail` rejected (e.g. SendGrid 401
`Maximum credits exceeded`). The bug existed in both environments, but
**Heroku auto-restarts hid it in production**, while local dev had no
supervisor and stayed dead until a file save woke `ts-watch` back up.

## Why local crashes loud

- `npm run dev` launches `ts-watch` + `ts-start` via `concurrently`.
  `ts-start` runs the compiled `build/src/index.js` once. There is no
  process supervisor.
- When the process exits, `concurrently` prints the message below and
  the server stays down:

  ```text
  Failed running 'build/src/index.js'. Waiting for file changes before restarting...
  ```

- All in-flight requests (e.g. `/song` from JaMmusic's Songs page) hang
  because the backend isn't listening, which is exactly the symptom
  reported on 2026-05-08: "navigating to Songs page does not load".

## Why production hides it

`Procfile`:

```text
web: node build/src/index.js
```

`package.json`:

```json
"engines": { "node": "24.15.0" }
```

That's a Heroku-style deploy. Heroku's dyno manager:

1. Detects the `web` process exited.
2. Returns **H10 / 503** to any request landing during the gap.
3. Spawns a new dyno within ~10s.
4. Service reads as "up" again.

A casual user sees "the page didn't load that one time"; a refresh
works. The crash *did* happen, but it's only visible in
`heroku logs --tail`:

```text
app crashed - State changed from up to crashed
State changed from crashed to starting
```

This is "production has a supervisor that hides it", not "doesn't
reproduce in production".

## Why local triggers it but production might not

The crash also requires SendGrid to actually reject. Two things make
that more likely on local than production:

1. **API keys differ.** `.env` typically holds a long-lived dev key on
   the SendGrid free tier. Production reads `SENDGRID_API_KEY` from
   Heroku config vars, often a different key (paid plan, separate
   sub-user, or just one not yet over its monthly cap).
2. **Traffic differs.** Repeated local form testing burns credits
   quickly on a free-tier key. Production gets far fewer real Contact Us
   submissions per day, so the credit ceiling is hit later or not at
   all.

So even with the same buggy code on the same Node version, production
may go weeks without ever triggering the crash, while local devs hit it
on the first round of inquiry testing after credits run out.

## Where the bug actually was

- `src/model/inquiry/index.ts` — fire-and-forget IIFE wrapping the async
  controller. The IIFE's promise was never returned to Express, so
  neither Express 4 nor Express 5's async-error pipeline saw the
  rejection.
- `src/model/inquiry/InquiryController.ts` — no try/catch around
  `sgMail.send`, so any provider error propagated up.
- Combined: the rejection escaped to the Node process. On Node ≥15
  (default `--unhandled-rejections=throw`), the process terminates.

The buggy code was introduced **2023-03-16** in commit `7fd8b8b`
("handleing promises"), well before the Express 5 upgrade. It stayed
dormant on Node 14 (which only logged a warning). The Express 5 PR
(#744) bumped the runtime to Node 24, which made the latent bug fatal.

## How to verify in production

```bash
# Crash history + 503s + inquiry requests
heroku logs --app <web-jam-back-app> --num 500 \
  | grep -E "crashed|H10|inquiry"

# Compare keys (do NOT paste these anywhere):
heroku config:get SENDGRID_API_KEY --app <web-jam-back-app>
grep SENDGRID_API_KEY .env
```

If the keys are the same and Heroku logs show `app crashed` events
clustered around inquiry requests, that confirms the same bug was
firing in prod too — Heroku just kept respawning the dyno fast enough
that no one filed a ticket.

## Fix shipped in PR #748

1. **Controller** wraps `sgMail.send` in try/catch and returns a clean
   502 with the provider error code/message.
2. **Router** uses a proper `async (req, res, next)` handler that
   forwards rejections to `next(err)` — Express 5 then handles it via
   the error middleware pipeline.
3. **Process** adds a `process.on('unhandledRejection', ...)` safety net
   in `src/index.ts` that logs and does NOT exit, so any future similar
   bug in any other route can't take the dev server down.

After the fix, the inquiry route stays up under SendGrid failures in
**both** environments. Production stops relying on Heroku's restart
loop to mask the bug.

## Open follow-ups

- The trigger today was `Maximum credits exceeded`. The fix prevents
  the crash but does not deliver email — the contact form will return
  502 until SendGrid is upgraded, or the integration is replaced
  (Mailgun / AWS SES / Resend).
- Add automated + manual coverage for SendGrid use cases from local
  before merging future inquiry changes; if the local flow remains
  flaky on the free tier, swap providers. Tracked in
  [#749](https://github.com/WebJamApps/web-jam-back/issues/749).

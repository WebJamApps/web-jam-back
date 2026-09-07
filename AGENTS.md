# Gemini Context: web-jam-back


## Cross-AI hard rules

The cross-AI hard rules that bind every agent on every surface are NOT duplicated here. They live
in exactly one file: `docs/cross-ai-rules.md` in the **`web-jam-tools` repository**, which normally
sits alongside this repository — `../web-jam-tools/docs/cross-ai-rules.md`, and on Josh's laptop
`/home/joshua/WebJamApps/web-jam-tools/docs/cross-ai-rules.md`.

Read that file before acting. If you cannot find it, STOP and say so — do not proceed without the
rules and do not reconstruct them from memory or from this file.

## Tech Stack
- **Runtime:** Node.js v24.19.0
- **Framework:** Express
- **Testing:** Vitest (vitest.config.ts)
- **Linting:** ESLint (eslint.config.mjs)

## Development Workflow
- **Build:** Check package.json for build scripts.
- **Explicit Permission Required Before Codework / PR Creation:** Never start code implementation, create feature branches/worktrees, commit changes, or open pull requests without explicit permission or a direct command from Josh in chat naming/approving the task. When investigating bugs or discovering root causes, stop after diagnosis to explain the findings and proposed solution, and wait for Josh's explicit go-ahead before writing code, modifying files, or submitting any PR.
- **Node Engine Version Bumps:** When bumping Node.js in `package.json` `engines.node`, always run `npm install --package-lock-only --ignore-scripts` (or `npm install --ignore-scripts`) to update `package-lock.json` root engine definition without triggering `postinstall` build scripts, so both files are committed together.
- **Standards:** Follow existing ESM patterns.
- **Vitest Config & Environment Variables**: Never hardcode test environment variables (such as `test.env.AllowUrl`) in shared, CI-executed `vitest.config.ts` to satisfy local test runs. Vitest's `test.env` overrides project-level CI environment variables across all test workers and silently overwrites production/CI test environments. If local test execution requires environment variables, configure them in uncommitted local `.env` files rather than modifying `vitest.config.ts`.
- **Merging:** Gemini is **NOT** allowed to merge PR changes to the `dev` or `main` branches. The user is the reviewer.

## Quota & Token Hygiene
- **Sliding Window Quota Preservation:** Google Antigravity (`agy`) tracks model token usage on a rolling 5-hour sliding window. To preserve quota and avoid 3+ hour lockouts during heavy or multi-repo tasks:
  - Keep command outputs compact: avoid printing thousands of lines of raw test logs directly into main turn outputs.
  - Redirect large multi-line summaries, test plans, and evidence to scratch files (`--summary-file`, `--test-plan-file`, `--test-evidence-file`) when calling `create-draft-pr.sh`.
  - **Automatic Flash Med Subagent Handoff on "Go":** Once requirements and implementation steps are aligned interactively on `Flash High`, automatically delegate contained execution work (coding, running test suites, branch/PR creation) down to a `Flash Med` subagent without waiting for Josh to explicitly request delegation.

## Routes & Verbs
- **Venue Updates (`/venue/:id`)**: `PATCH /venue/:id` is the partial-merge update verb (routing to `controller.updateVenue`). Address updates enforce immutability once set (`400: address cannot be removed`).
- **Setlist API Sorting (`GET /setlist` and `GET /setlist/:id`)**: Accepts `?sort=title` (or `sort=artist` / `sort=order`) to return items in alphabetical or specified order. Sorting is read-time view only and strips `sort` from Mongoose query params so stored MongoDB item order is never mutated.
- **Outreach Report Serving & Takedown (`/outreach/report`)**: `POST /outreach/report` (authenticated) stores or updates rendered HTML artifacts in MongoDB (`OutreachReport` collection). `GET /outreach/report/:weekend` (public) serves raw HTML directly with `Content-Type: text/html; charset=utf-8` and `Cache-Control: public, max-age=300`. `DELETE /outreach/report/:weekend` (authenticated) deletes the stored report document from MongoDB upon gig booking or decommission, returning HTTP 404 on subsequent requests.

## Outreach & Batch Guard Invariants
- **Gate 2 Draft Fingerprint Integrity**: Gate 2 draft copy approval strictly hashes `{ subject, body }` together (`computeDraftFingerprint({ subject, body })`). Never accept a body-only hash fallback during dispatch verification — subject line mutations must invalidate the gate and trigger refusal.
- **Single-Pass Verified Render Dispatch**: When verifying rendered draft content against stored Gate 2 fingerprints before batch dispatch, do not discard the verified rendered `{ subject, html, attachments }` and re-render during send. Pass the verified rendering directly into `performSend` to guarantee the exact verified bytes are sent.
- **Verification Never Replaces the Sendability Guards**: Gate 2 verification is a COPY-INTEGRITY check only. It renders with `{ skipDedup: true, requireEligible: false }` so it can fingerprint any venue, so the send loop MUST still resolve every venue — verified or not — through `resolvePitch` with production defaults (`requireEligible: true`, `skipDedup: false`) before mailing it. Reuse the verified rendering as `preRendered` bytes ONLY; never let it stand in for the eligibility (#844) or dedup (#923) checks. Skipping them lets a re-POSTed batch mail every venue twice and mails a venue whose `outreachEligible` was revoked (including permanently, by `not-interested`) after approval.
- **Deterministic Batch Lookup & Scope**: When querying batch approval records for a target weekend, prefer exact `batchId` matching before falling back to weekend-level matching, and always sort deterministically (`.sort({ createdAt: -1, _id: -1 })`) so multi-batch weekends resolve predictably rather than matching arbitrary documents in natural order.


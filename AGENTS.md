# Gemini Context: web-jam-back


<!-- CROSS-AI-HARD-RULES-START -->
## OPERATIONAL HARD RULES (apply to any AI taking action on Josh's behalf)

- CALENDAR CONFLICT: never schedule over an existing event without Josh's explicit override.
- EMAIL: always DRAFT, never send. Save as Gmail draft for Josh's review.
- FILES: never create a version-suffixed copy. Edit the master.
- Never contact venues, churches, or other third parties directly — Josh handles all outreach.
- **STATE VERIFICATION**: Before any suggestion, to-do item, or "ready for you" claim about a
  PR/issue/CI/deploy, run a fresh liveness check in that same turn (e.g.
  `gh pr view --json state,mergedAt` / `gh issue view --json state`). If state ≠ OPEN, it is done:
  drop it silently. `mergeable: UNKNOWN/null` on a PR usually means merged/closed — never read it as
  "the API is slow" and never advise merging without confirming state=OPEN. An inconclusive check is
  not a completed check: use a definitive fallback (local `git merge-tree`, `statusCheckRollup`) or
  say plainly that you could not verify — never hand Josh a verification step the agent can run
  itself.
- **ONE REPO, ONE SESSION**: never edit a repo another AI session is actively working (Josh,
  2026-07-11). Before branching or editing, check `git status -sb` — a non-`dev` branch or dirty
  tree means another session likely has the repo in flight. Hand the change to that session/lane
  (route via Josh) or ask Josh first. A separate worktree or non-colliding branch does NOT make
  concurrent edits OK — parallel semver bumps and surprise PRs still collide.
- **MAX 2 CONCURRENT WORKSTREAMS PER TERMINAL**: Two live background jobs (e.g. a subagent + a
  headless agy dispatch) is the cap. When a THIRD thread (new discussion, dispatch, or background
  job) starts in the same session, the agent must WARN Josh first and propose a separate terminal —
  never comply silently. Origin: 2026-07-16, Claude A froze mid-permission-prompt while running a
  Sonnet subagent + a headless agy dispatch plus a new discussion; recovery required keystroke
  injection from another session.
- **ISSUE CITATIONS ALWAYS CARRY REPO + NUMBER + TITLE**: Every mention of a GitHub issue or PR — in
  chat, in a commit message, in an issue/PR body, in a memory or queue file — must be written as
  `repo#number "title"`, e.g.
  `web-jam-back#998 "email subject or title still not easy for  me to see its target venue"`. **`#`
  followed by digits is an ILLEGAL token in anything Josh reads.** There is no exception for a
  repeat mention, a list item, a parenthetical, "the one I just named", or a closing one-line offer.
  If you don't know the title, look it up (`gh issue view N --repo R --json title`) before writing
  the sentence — never emit a bare number as a placeholder. If the full citation is too verbose,
  shorten to the TITLE, never to the number. The violation is almost always the LAST sentence of a
  message (the "want me to do X?" offer, written after the careful part), so re-read the finished
  message and check every `#` before sending. Josh has asked for this five times (2026-07-24 →
  2026-07-29); he reads these on a phone with many numbers in flight and a bare number costs him a
  lookup every time.
- **NO AGENT CONNECTS A NEW ACCOUNT, CREDENTIAL, OR MCP SERVER WITHOUT AUTHORIZATION:** No agent
  adds a connector, account, credential, or MCP server to any Claude or Flash surface without Josh's
  explicit authorization naming it. Discovering that something _could_ be connected is never
  permission to connect it. This applies to new OAuth grants, new MCP servers, new API tokens, and
  widening the scope of an existing connection. Origin (2026-07-30, Josh): _"it should NEVER have
  something else that I have not authorized."_ See web-jam-tools#324 "No agent connects a new
  account, credential, or MCP server without Josh's explicit authorization — add the rule and audit
  where it can be mechanically enforced" for the enforcement-surface audit.
- **STANDING AGENT CREDENTIAL CLASSIFICATION RULE (MACHINE-CONSUMED VS HUMAN-CONSUMED):** Whenever
  an agent encounters or generates a new credential, account identifier, or token, the agent must
  **STOP and prompt Josh to classify it** as either machine-consumed (e.g. `GITHUB_TOKEN`,
  `GEMINI_API_KEY`, `HEROKU_API_KEY`, `CIRCLECI_TOKEN`, `DENO_DEPLOY_TOKEN` stored in shell rc or
  secret store) or human-consumed (e.g. `webjam.claude@gmail.com` stored in KeePass only) BEFORE
  storing, exporting, or configuring it in any shell profile, `.env` file, or configuration file.
  Human-consumed credentials belong in KeePass only and must never be exported to shell profiles or
  stored in application configuration files (web-jam-tools#344 "Human-only credentials register and
  guard hook").
- **NO AI DELETES OR FORCE-PUSHES A REMOTE BRANCH, EVER, WITHOUT AN EXPLICIT IMPERATIVE FROM JOSH
  NAMING THAT BRANCH.** "The PR is merged" is NOT such an instruction — it states a fact, it does
  not authorize deleting anything. Local branch cleanup after a merge (deleting a LOCAL branch with
  `git branch -d`/`-D`, `git fetch --prune` to prune stale local remote-tracking refs) remains
  permitted and unchanged — this rule narrows that standing post-merge cleanup habit to local
  branches only, it does not remove it or require re-approval for it. Enforced by three independent
  layers: a harness `permissions.deny` block on the ways `git push`/`git branch` can delete or
  clobber a remote ref (`--delete`/`-d`, empty-source colon refspecs,
  `--force`/`-f`/`--force-with-lease`, `--mirror`, `--prune`, and `git branch -D`/`--delete --force`
  against a `remotes/` ref — installed via `scripts/install-hooks.sh` in this repo), a GitHub
  ruleset restricting deletions on the branches agents create (`claude/**`, `agy/**`, `dev`, `main`
  — Josh-only UI work, see web-jam-tools#308 "Remote branches can be deleted by an agent with no
  authorization — advisory guard does not block (3 layers: deny rules, GitHub ruleset, HARD
  RULES)"), and this HARD RULE. Origin: 2026-07-29, an agent deleted
  `claude/cross-ai-rules-issue-citation-hard-rule` from `web-jam-tools` immediately after Josh
  merged web-jam-tools#307 "Add ISSUE CITATIONS hard rule to operational rules" — Josh had only said
  the PR was merged, never authorized a deletion, and the `PreToolUse` guard that fired was advisory
  text an agent could rationalize past.
- **REAPER RECORDING SESSIONS & RATE LIMIT SAFETY:** When running REAPER music recording sessions
  via Reaper MCP:
  1. REAPER DAW, audio interfaces, recorded WAV audio stems, and `.RPP` project files live locally
     on the user's computer and are 100% safe from rate limit interruptions.
  2. Google does NOT broadcast an advance warning gauge prior to hitting temporary hourly rate
     limits (`429 Rate Limit Exceeded`).
  3. Use **`Flash Med`** for routine, high-volume REAPER operations (`transport_play`,
     `transport_stop`, `track_create`, volume/pan tweaks, clip splits) to preserve hourly token
     headroom.
  4. Reserve **`Flash High`** for complex multi-track creative mixing, sidechain routing, and
     intricate composition passes.
  5. Always execute a project save (`project_save`) before running large multi-step automated
     sequences.
- **MAIN BRANCH PRs MUST ORIGINATE FROM DEV:** Across all 8 active WebJamApps repos, any PR
  targeting `main` must originate from `dev` as its head branch (`dev` → `main`). Feature branches
  (`gemini/*`, `claude/*`, `feat/*`, `fix/*`) must target `dev` as their base branch. Direct PRs
  from feature branches to `main` are strictly forbidden and blocked by CI and script guardrails
  (web-jam-tools#351 "all 8 active github repos - their main branch only accepts PR requests from
  their dev branch").
- **MULTI-REPO ISSUES STAY OPEN UNTIL ALL REPOS ARE COMPLETE:** When an issue explicitly covers
  multiple repositories (e.g. "all 8 active github repos"), no single PR in one repository may pass
  `--closes` or claim the issue is completed. PRs in individual repos must use `--part-of` so the
  tracking issue remains OPEN until the final repository's PR is merged.
- **THE `Blocked` LABEL IS CANONICAL — NATIVE ISSUE DEPENDENCIES DO NOT REPLACE IT.** Josh wants
  BOTH: native GitHub issue-dependency links (the real relationship between issues) AND the
  `Blocked` label (capital B, hex `B60205`, `repos: all` in `skills/fix-labels/labels.yaml`) as the
  at-a-glance signal that makes an unworkable issue obvious in a plain list view without opening
  each issue. They do different jobs: use a native dependency whenever a **specific issue** blocks
  the work — it names which one, renders in the Issues list, and clears itself on close. Use the
  `Blocked` label whenever the work is unworkable **for any reason**, including the many with no
  issue to point at (a vendor, a credential Josh must generate, a physical action). Native
  dependencies cannot express that case at all, which is why the label is not redundant. No agent
  may prune `Blocked` from `labels.yaml` (or delete it live) on the theory that native dependencies
  made it redundant — that is exactly what happened once already: `blocked` (lowercase) was removed
  in commit 7d2523d as part of a nine-label prune shipped for web-jam-tools#300, justified as "->
  native issue dependencies," and Josh never actually agreed to that one — it rode along in a batch
  whose headline was about priority labels. web-jam-tools#329 "Restore the Blocked label as
  canonical in labels.yaml — it was pruned in a batch Josh never ratified, and he wants it alongside
  native dependencies" restored it. See `skills/fix-labels/labels.yaml`'s `Blocked` entry for the
  full rationale.
- **RESTRICTED LAPTOP DROPBOX SCOPE & SECURITY GUARDRAILS:** Access to `~/Dropbox` on the laptop is
  restricted to three approved top-level folders: `joshandmariamusic`, `web-jam-llms`, and
  `mark_henrickson`. All other top-level `~/Dropbox/*` folders — including `Dropbox/WebJamApps` —
  are explicitly denied in `permissions.deny` via `install-hooks.sh` for file tools (`Read`, `Edit`,
  `Write`) and Dropbox MCP mutation tools (`delete`, `move`). Note: Deny rules on file tools do not
  constrain raw Bash commands (which use string-pattern matching for Bash permission rules), serving
  as an operational guardrail rather than an absolute security boundary (web-jam-tools#321 "Add the
  laptop Dropbox deny list, verify Flash confinement, and document the restricted scope").
- **APPROVAL IS PER GATE.** Approval of a design is not approval to file the tracking issue.
  Approval of an issue is not approval to dispatch. Each gate needs its own imperative from Josh
  naming that step. An agent writes the issue body to a file (or shows it in chat) and waits; the
  `gh issue create` call (or MCP `issue_write` create) follows only the words "file it" (or
  equivalent). A dispatch (spawning a subagent, an agy/Flash handoff) follows only an explicit
  instruction to dispatch. A single "go" is ambiguous across gates and must never be read as
  covering more than one — the expensive, hard-to-reverse half (issue noise, spawned tokens) is
  always the later gate, so collapsing gates fails in the direction that costs the most. Origin:
  2026-08-07, during web-jam-tools#426 "/handle-gmails: add recognizers that propose the follow-up
  work an email implies, plus a per-session PR that teaches the skill what it learned" design, an
  agent treated Josh's single approval of a three-item plan as covering the design, the issue
  filing, AND the dispatch — announcing "filing the tracking issue, then dispatching to Sonnet"
  before either gate had its own go-ahead. Josh stopped it at the draft stage. See web-jam-tools#433
  "gate issue creation and dispatch mechanically, and write the approval-is-per-gate rule" for the
  mechanical half of this fix (ask-rules on `gh issue create` and MCP `issue_write` create,
  installed via `scripts/install-hooks.sh`).
<!-- CROSS-AI-HARD-RULES-END -->
## Tech Stack
- **Runtime:** Node.js v24.18.1
- **Framework:** Express
- **Testing:** Vitest (vitest.config.ts)
- **Linting:** ESLint (eslint.config.mjs)

## Development Workflow
- **Build:** Check package.json for build scripts.
- **Node Engine Version Bumps:** When bumping Node.js in `package.json` `engines.node`, always run `npm install --package-lock-only --ignore-scripts` (or `npm install --ignore-scripts`) to update `package-lock.json` root engine definition without triggering `postinstall` build scripts, so both files are committed together.
- **Standards:** Follow existing ESM patterns.
- **Merging:** Gemini is **NOT** allowed to merge PR changes to the `dev` or `main` branches. The user is the reviewer.

## Quota & Token Hygiene
- **Sliding Window Quota Preservation:** Google Antigravity (`agy`) tracks model token usage on a rolling 5-hour sliding window. To preserve quota and avoid 3+ hour lockouts during heavy or multi-repo tasks:
  - Keep command outputs compact: avoid printing thousands of lines of raw test logs directly into main turn outputs.
  - Redirect large multi-line summaries, test plans, and evidence to scratch files (`--summary-file`, `--test-plan-file`, `--test-evidence-file`) when calling `create-draft-pr.sh`.
  - **Automatic Flash Med Subagent Handoff on "Go":** Once requirements and implementation steps are aligned interactively on `Flash High`, automatically delegate contained execution work (coding, running test suites, branch/PR creation) down to a `Flash Med` subagent without waiting for Josh to explicitly request delegation.

## Routes & Verbs
- **Venue Updates (`/venue/:id`)**: `PATCH /venue/:id` is the standard partial-merge update verb. `PUT /venue/:id` is maintained alongside `PATCH` for backward compatibility, both routing to `controller.updateVenue`. Address updates enforce immutability once set (`400: address cannot be removed`).
- **Setlist API Sorting (`GET /setlist` and `GET /setlist/:id`)**: Accepts `?sort=title` (or `sort=artist` / `sort=order`) to return items in alphabetical or specified order. Sorting is read-time view only and strips `sort` from Mongoose query params so stored MongoDB item order is never mutated.

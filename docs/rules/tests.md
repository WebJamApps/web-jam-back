# tests rules



- **No Real Identifiers in Public Tests**: Never use real account numbers, writer IPIs, or work numbers in tests or committed fixtures in public repositories. Always use clearly fabricated test identifiers (`TEST-BMI-001`, `FAKE-IPI-001`).


- **No Raw `any` in Test Suites & Mock Typing**: New or modified TypeScript tests must never introduce raw `any` (`outreachDoc as any`, `mockData as any`). Declare test fixtures with their exported interfaces (e.g. `OutreachDoc`) or use strict double-casts (`as unknown as OutreachDoc`) once at definition. Export internal document and param interfaces from controllers when helper functions (such as `buildFollowUpEmail`) require them so consumers and test specs remain strictly typed without type escapes.


- **Model Stub & Express Request Typing in Tests**: Never cast test doubles with raw `as any` (e.g. `(model as any).findById = ...`, `const req: any = ...`). Use typed double-casts (`(model as unknown as { findById: ReturnType<typeof vi.fn> })`) and typed Express request types (`req as unknown as Request`) to preserve static type guarantees across test suites.


- **Route-Level Test Coverage for Auth & Guard Outcomes**: When acceptance criteria require test coverage for all guard outcomes (allowed, 401/403 refusal, and auth lookup failure / DB error -> 500), unit tests must cover the failure outcome (outcome 3, where auth lookup throws or rejects) at the HTTP route level (e.g. `request(app).post(...)`, `request(app).get(...)`) asserting a 500 status and verifying nothing was saved or returned, rather than only testing the controller helper method in isolation.


- **Distinguishing User-Not-Found from Lookup Failure in Guard Tests**: Tests where a token user does not exist in the database verify authorization refusal (outcome 2, returning 401), not an infrastructure lookup error (outcome 3, returning 500 when `findById` rejects). Test descriptions must accurately distinguish between missing user records and database rejection.


- **Lockfile Root Version Synchronization on Semver Bumps**: When bumping `package.json`'s version, always run `npm install --package-lock-only --ignore-scripts` to synchronize the version metadata in `package-lock.json` (both top-level `"version"` and `packages[""]["version"]`) so both manifests consistently describe the same release version in lockstep.


- **Global `fetch` Mocking with Ephemeral Test Client & Test Isolation**: `test/helpers/api.ts`'s `request(app)` executes HTTP requests via `globalThis.fetch`. When test suites mock `globalThis.fetch` or `global.fetch` via `vi.spyOn(global, 'fetch')`, they must: (1) bind the unmocked native fetch (`const realFetch = globalThis.fetch.bind(globalThis);`) at module scope and forward non-mocked URLs (such as local ephemeral server requests) to `realFetch(url, init)`; and (2) strictly restore mocks in `afterEach(() => vi.restoreAllMocks())`. Failure to restore mocks causes subsequent tests in the same file to re-wrap the already-spied fetch, leading to infinite recursion and `RangeError: Maximum call stack size exceeded`.

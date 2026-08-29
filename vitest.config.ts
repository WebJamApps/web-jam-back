import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '#src': path.resolve(import.meta.dirname, 'src'),
      '#lib': path.resolve(import.meta.dirname, 'src/lib'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.spec.ts'],
    bail: 1,
    mockReset: true,
    // Integration specs share one Mongo test DB and some wipe whole collections
    // (e.g. userModel.deleteMany({})). Run test files strictly sequentially so one
    // file's cleanup can't wipe another file's auth user mid-request — the cause
    // of the intermittent 401 in book-router's "should update one book".
    fileParallelism: false,
    pool: 'forks',
    forks: { singleFork: true },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Manually-run migration/ops scripts (never imported by the app or a
      // test, run by hand via `npm run migrate:*` / heroku run) — excluded
      // from the coverage gate the same way scripts/*.mjs already is by
      // living outside src/. #923's migrate-target-weekend.ts needs to live
      // under src/ so tsconfig.prod.json's build compiles it to build/, but
      // it shouldn't drag the 90% statements gate down as dead-to-tests code.
      exclude: ['src/scripts/**'],
      reporter: ['text', 'html', 'lcov'],
      // CI gate: vitest exits non-zero (failing `npm test` on CircleCI) when
      // total coverage drops below these floors. Statements + lines held at the
      // 90% target; branches + functions floored at 80% — the repo's routers are
      // exercised via controllers, not unit-tested directly, so those two metrics
      // sit in the low-/mid-80s. Raise them as direct route tests are added.
      thresholds: {
        statements: 90,
        lines: 90,
        branches: 80,
        functions: 80,
      },
    },
  },
});

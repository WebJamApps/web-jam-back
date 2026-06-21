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
    pool: 'forks',
    forks: { singleFork: true },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
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

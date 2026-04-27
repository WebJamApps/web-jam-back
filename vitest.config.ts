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
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});

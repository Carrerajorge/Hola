import { defineConfig } from 'vitest/config'; import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      // Keep coverage output stable; CI/quality gate controls cleanup between retries.
      clean: false,
      reporter: ['text', 'json', 'json-summary', 'html'],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 20,
        statements: 30,

      },
    },
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});

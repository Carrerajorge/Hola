import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Default is 5s; this repo contains intentional stress/perf tests (Excel parsing, crypto hashing, etc.).
    testTimeout: 30000,
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'server/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});

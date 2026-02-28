import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["**/*.browser.test.ts", "happy-dom"],
    ],
    testTimeout: 15000,
    include: ["tests/**/*.test.ts", "server/**/*.test.ts"],
    exclude: [
      "server/openclaw/**",
      "dist/**",
      "node_modules/**",
      "Hola/**",
      "Hola_wt_*/**",
      ".claude/**",
      ".codex/**",
    ],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      // Keep coverage output stable; scripts/quality-gate.ts controls cleanup + thresholds.
      clean: false,
      reporter: ["text", "json", "json-summary", "html"],
      all: true,
      include: ["server/core/**/*.ts"],
      exclude: ["**/*.test.ts", "**/__tests__/**", "**/node_modules/**", "**/dist/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});

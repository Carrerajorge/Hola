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
      "**/*.integration.test.ts",
      "**/*.integration.spec.ts",
      "dist/**",
      "node_modules/**",
      "Hola/**",
      "Hola_wt_*/**",
      ".claude/**",
      ".codex/**",
      "**/*.e2e.test.ts",
      "**/*.e2e.spec.ts",
      "server/workflow/schemaSetup.ts",
      "tests/integration/**",
      "server/workflow/workflowStore.test.ts",
      "server/services/superIntelligence/**/*.test.ts",
      "server/services/superIntelligence/**/*.spec.ts",

      "server/agent/__tests__/agent.test.ts",
      "tests/unit/pipeline-tools-registration.test.ts",
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

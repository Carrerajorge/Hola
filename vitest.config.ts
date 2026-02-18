import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    include: ["tests/**/*.test.ts", "server/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      // Keep coverage output stable; scripts/quality-gate.ts controls cleanup + thresholds.
      clean: false,
      reporter: ["text", "json", "json-summary", "html"],
    },
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});

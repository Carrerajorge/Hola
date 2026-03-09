import { describe, expect, it } from "vitest";
import { runOpenClawRuntimeBenchmarks } from "./openclawRuntimeBenchmarks";

const describeBench = process.env.RUN_BENCHMARKS === "true" ? describe : describe.skip;

describeBench("OpenClaw Runtime Benchmarks", () => {
  it(
    "passes the complex runtime performance battery",
    async () => {
      const results = await runOpenClawRuntimeBenchmarks();
      for (const result of results) {
        expect(result.passed, `${result.name}: ${result.failures.join(" | ")}`).toBe(true);
      }
    },
    120_000,
  );
});

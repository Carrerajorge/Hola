#!/usr/bin/env node --import tsx
import fs from "node:fs";
import path from "node:path";
import {
  runOpenClawRuntimeBenchmarks,
  type OpenClawRuntimeBenchmarkResult,
} from "../server/services/openclawRuntimeBenchmarks";

function renderMetrics(metrics: OpenClawRuntimeBenchmarkResult["metrics"]) {
  return Object.entries(metrics)
    .map(([key, value]) => `${key}=${typeof value === "number" ? value.toFixed(2) : value}`)
    .join(" | ");
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.resolve(process.cwd(), "test_results");
  const reportPath = path.join(reportDir, `openclaw_runtime_benchmark_${timestamp}.md`);
  const latestReportPath = path.join(reportDir, "openclaw_runtime_benchmark_latest.md");
  const skipReport = process.env.OPENCLAW_BENCHMARK_STDOUT_ONLY === "true";
  const startedAt = Date.now();

  try {
    const results = await runOpenClawRuntimeBenchmarks();
    const durationMs = Date.now() - startedAt;
    const passed = results.every((result) => result.passed);

    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      console.log(`[OpenClaw Benchmark Report] ${status} ${result.name} | ${renderMetrics(result.metrics)}`);
      if (!result.passed) {
        for (const failure of result.failures) {
          console.log(`[OpenClaw Benchmark Failure] ${result.name} | ${failure}`);
        }
      }
    }

    if (!skipReport) {
      const report = [
        "# OpenClaw Runtime Benchmark Report",
        "",
        `- Generated: ${new Date().toISOString()}`,
        `- Status: ${passed ? "PASSED" : "FAILED"}`,
        `- Duration: ${(durationMs / 1000).toFixed(2)}s`,
        "",
        "## Results",
        "",
        ...results.flatMap((result) => [
          `### ${result.name}`,
          "",
          `- Status: ${result.passed ? "PASS" : "FAIL"}`,
          `- Metrics: ${renderMetrics(result.metrics)}`,
          `- Budgets: ${renderMetrics(result.budgets)}`,
          ...(result.failures.length > 0
            ? ["- Failures:", ...result.failures.map((failure) => `  - ${failure}`)]
            : ["- Failures: none"]),
          "",
        ]),
      ].join("\n");

      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(reportPath, report, "utf8");
      fs.writeFileSync(latestReportPath, report, "utf8");
      console.log(`Benchmark report saved to ${reportPath}`);
      console.log(`Latest report saved to ${latestReportPath}`);
    }

    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error("[OpenClaw Benchmark Error]", error);
    process.exit(1);
  }
}

void main();

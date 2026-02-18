import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface GateCheckResult {
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  exitCode?: number;
  details?: string;
}

interface CoverageMetric {
  pct: number;
  covered?: number;
  total?: number;
}

interface CoverageSummary {
  total: {
    lines: CoverageMetric;
    statements: CoverageMetric;
    functions: CoverageMetric;
    branches: CoverageMetric;
  };
}

const QUALITY_REPORT_PATH = "test_results/quality-gate-report.json";
const DEFAULT_THRESHOLDS = {
  lines: Number(process.env.QUALITY_GATE_LINES || 90),
  statements: Number(process.env.QUALITY_GATE_STATEMENTS || 90),
  functions: Number(process.env.QUALITY_GATE_FUNCTIONS || 90),
  branches: Number(process.env.QUALITY_GATE_BRANCHES || 90),
};

const CI_DEFAULT_ENV: Record<string, string> = {
  CI: "true",
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
  SESSION_SECRET: "ci-session-secret-min-32-chars",
  OPENAI_API_KEY: "ci_dummy_key",
  GEMINI_API_KEY: "ci_dummy_key",
  XAI_API_KEY: "ci_dummy_key",
  ANTHROPIC_API_KEY: "ci_dummy_key",
};

function runCommand(
  name: string,
  command: string,
  args: string[],
  required: boolean,
  env: NodeJS.ProcessEnv,
): GateCheckResult {
  const started = Date.now();
  const result = spawnSync(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 80 * 1024 * 1024,
    shell: false,
  });

  const durationMs = Date.now() - started;
  const exitCode = result.status ?? 1;
  const output = `${result.stdout?.toString().trim()} ${result.stderr?.toString().trim()}`.trim();

  if (result.status === 0) {
    return {
      name,
      command: `${command} ${args.join(" ")}`.trim(),
      status: "passed",
      durationMs,
      exitCode,
    };
  }

  if (!required) {
    return {
      name,
      command: `${command} ${args.join(" ")}`.trim(),
      status: "skipped",
      durationMs,
      exitCode,
      details: output.slice(0, 2000),
    };
  }

  console.error(`[quality-gate] ${name} failed:`);
  if (output) {
    console.error(output);
  }
  return {
    name,
    command: `${command} ${args.join(" ")}`.trim(),
    status: "failed",
    durationMs,
    exitCode,
    details: output.slice(0, 4000),
  };
}

function parseCoverageSummary(): CoverageSummary | null {
  const coveragePath = path.join(process.cwd(), "coverage", "coverage-summary.json");
  if (!fs.existsSync(coveragePath)) {
    return null;
  }

  const raw = fs.readFileSync(coveragePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed?.total) {
    return null;
  }

  return parsed as CoverageSummary;
}

function checkCoverageThresholds(): GateCheckResult {
  const started = Date.now();
  const coverage = parseCoverageSummary();

  if (!coverage?.total) {
    return {
      name: "Coverage threshold check",
      command: "coverage-summary.json",
      status: "failed",
      durationMs: Date.now() - started,
      details: "coverage-summary.json not found",
      exitCode: 1,
    };
  }

  const failures: string[] = [];
  const checks: Array<{ metric: keyof typeof DEFAULT_THRESHOLDS; threshold: number; value: number }> = [
    { metric: "lines", threshold: DEFAULT_THRESHOLDS.lines, value: coverage.total.lines.pct },
    { metric: "statements", threshold: DEFAULT_THRESHOLDS.statements, value: coverage.total.statements.pct },
    { metric: "functions", threshold: DEFAULT_THRESHOLDS.functions, value: coverage.total.functions.pct },
    { metric: "branches", threshold: DEFAULT_THRESHOLDS.branches, value: coverage.total.branches.pct },
  ];

  for (const check of checks) {
    if (check.value < check.threshold) {
      failures.push(`${check.metric}: ${check.value.toFixed(2)}% < ${check.threshold}%`);
    }
  }

  return failures.length > 0
    ? {
        name: "Coverage threshold check",
        command: "coverage-summary.json",
        status: "failed",
        durationMs: Date.now() - started,
        exitCode: 1,
        details: failures.join("; "),
      }
    : {
        name: "Coverage threshold check",
        command: "coverage-summary.json",
        status: "passed",
        durationMs: Date.now() - started,
        exitCode: 0,
      };
}

function buildReport(checks: GateCheckResult[]) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;
  const report = {
    timestamp: new Date().toISOString(),
    thresholds: DEFAULT_THRESHOLDS,
    git: {
      sha: process.env.GITHUB_SHA || "local",
      ref: process.env.GITHUB_REF || "local",
      runId: process.env.GITHUB_RUN_ID || "local",
    },
    summary: {
      total: checks.length,
      passed,
      failed,
      skipped,
    },
    checks,
    status: failed > 0 ? "failed" : "passed",
  };

  fs.mkdirSync(path.dirname(QUALITY_REPORT_PATH), { recursive: true });
  fs.writeFileSync(QUALITY_REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

async function run() {
  const checks: GateCheckResult[] = [];
  const runEnv = { ...process.env, ...CI_DEFAULT_ENV };

  checks.push(
    runCommand(
      "Architecture boundaries (server/core)",
      "node",
      ["--import", "tsx", "scripts/layer-check.ts"],
      true,
      runEnv,
    ),
  );
  checks.push(runCommand("Type-check (application/runtime)", "npm", ["run", "type-check:app"], true, runEnv));
  checks.push(runCommand("Unit tests + coverage", "npm", ["run", "test:coverage"], true, runEnv));
  checks.push(runCommand("Security baseline (npm audit)", "npm", ["audit", "--omit=dev", "--audit-level=high"], true, runEnv));

  checks.push(checkCoverageThresholds());
  const report = buildReport(checks);
  const failed = report.summary.failed > 0;

  if (failed) {
    console.error("[quality-gate] blocked: one o más checks no alcanzaron el umbral");
    process.exitCode = 1;
    return;
  }

  console.log("[quality-gate] passed");
  process.exitCode = 0;
}

run().catch((error) => {
  console.error("[quality-gate] unexpected error:", error);
  process.exit(1);
});

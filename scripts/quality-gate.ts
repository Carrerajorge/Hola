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
  rawOutput?: string;
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

type CoverageMetricName = keyof CoverageSummary["total"];
type ThresholdConfig = Record<CoverageMetricName, number>;

interface ThresholdLoadResult {
  values: ThresholdConfig;
  diagnostics: string[];
}

const QUALITY_REPORT_PATH = "test_results/quality-gate-report.json";
const COVERAGE_BASE_DIR = path.join(process.cwd(), "coverage");
const COVERAGE_SUMMARY_PATH = path.join(COVERAGE_BASE_DIR, "coverage-summary.json");
const COVERAGE_FINAL_PATH = path.join(COVERAGE_BASE_DIR, "coverage-final.json");
const COVERAGE_TEMP_DIR = path.join(COVERAGE_BASE_DIR, ".tmp");
const COVERAGE_MAX_RETRIES = 3;
const COVERAGE_ERROR_OUTPUT_LIMIT = 20_000;

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  lines: 90,
  statements: 90,
  functions: 90,
  branches: 90,
};

const FALLBACK_COVERAGE_CONTEXT = 5;
const COVERAGE_HEURISTIC_POLL_MS = 250;
const COVERAGE_TRANSIENT_PATTERNS: RegExp[] = [
  /ENOENT: no such file or directory/i,
  /coverage\.\/\.tmp\/coverage-/i,
  /Unexpected non-whitespace character after JSON/i,
  /Unexpected end of JSON input/i,
  /V8CoverageProvider\.readCoverageFiles/i,
  /Could not read coverage data/i,
];

const CI_DEFAULT_ENV: Record<string, string> = {
  CI: "true",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/iliagpt",
  SESSION_SECRET: "ci-session-secret-min-32-chars",
  OPENAI_API_KEY: "ci_dummy_key",
  GEMINI_API_KEY: "ci_dummy_key",
  XAI_API_KEY: "ci_dummy_key",
  ANTHROPIC_API_KEY: "ci_dummy_key",
};

function parseThreshold(metric: CoverageMetricName): { value: number; diagnostic?: string } {
  const envKey = `QUALITY_GATE_${metric.toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw === undefined || raw === null) {
    return { value: DEFAULT_THRESHOLDS[metric] };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      value: DEFAULT_THRESHOLDS[metric],
      diagnostic: `env ${envKey} is empty; using default ${DEFAULT_THRESHOLDS[metric]}`,
    };
  }

  const parsed = Number(trimmed.replace(/%$/, ""));
  if (!Number.isFinite(parsed)) {
    return {
      value: Number.NaN,
      diagnostic: `env ${envKey}=${JSON.stringify(raw)} is not numeric`,
    };
  }
  if (parsed < 0 || parsed > 100) {
    return {
      value: Number.NaN,
      diagnostic: `env ${envKey}=${parsed} must be between 0 and 100`,
    };
  }

  return { value: parsed };
}

function loadThresholds(): ThresholdLoadResult {
  const diagnostics: string[] = [];
  const values = {} as ThresholdConfig;

  (Object.keys(DEFAULT_THRESHOLDS) as CoverageMetricName[]).forEach((metric) => {
    const { value, diagnostic } = parseThreshold(metric);
    if (!Number.isFinite(value)) {
      values[metric] = DEFAULT_THRESHOLDS[metric];
    } else {
      values[metric] = value;
    }
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  });

  return { values, diagnostics };
}

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
  const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`;
  const outputForDetails = output.trim();
  const details = outputForDetails
    ? outputForDetails.slice(-COVERAGE_ERROR_OUTPUT_LIMIT)
    : outputForDetails;

  if (result.status === 0) {
    return {
      name,
      command: `${command} ${args.join(" ")}`.trim(),
      status: "passed",
      durationMs,
      exitCode,
      rawOutput: output,
    };
  }

  if (!required) {
    return {
      name,
      command: `${command} ${args.join(" ")}`.trim(),
      status: "skipped",
      durationMs,
      exitCode,
      details,
      rawOutput: output,
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
    details,
    rawOutput: output,
  };
}

function parseCoveragePercent(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    const candidate = Number(value);
    if (!Number.isFinite(candidate)) {
      return null;
    }
    return candidate;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isCoverageTempRaceError(output: string): boolean {
  return output.includes("ENOENT: no such file or directory, open")
    && output.includes("coverage/.tmp/coverage-");
}

function isCoverageParserError(output: string): boolean {
  return output.includes("Unexpected non-whitespace character after JSON") ||
    output.includes("Unexpected end of JSON input") ||
    output.includes("V8CoverageProvider.readCoverageFiles") ||
    output.includes("coverage.final") ||
    output.includes("Could not read coverage data") ||
    output.includes("Could not parse coverage data");
}

function isRecoverableCoverageError(output: string): boolean {
  return COVERAGE_TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupCoverageArtifacts(): void {
  try {
    fs.rmSync(COVERAGE_BASE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup issues, retry path will handle if they persist
  }
}

async function runCoverageWithRetry(env: NodeJS.ProcessEnv): Promise<GateCheckResult> {
  const coverageCommands: Array<{
    name: string;
    command: string;
    args: string[];
  }> = [
    {
      name: "Unit tests + coverage (npm script)",
      command: "npm",
      args: ["run", "test:coverage"],
    },
    {
      name: "Unit tests + coverage (npm script, serialized files)",
      command: "npm",
      args: ["run", "test:coverage", "--", "--no-file-parallelism"],
    },
    {
      name: "Unit tests + coverage (vitest direct fallback)",
      command: "npx",
      args: [
        "vitest",
        "run",
        "--coverage",
        "--no-file-parallelism",
        "--maxWorkers=1",
        "--coverage.provider=v8",
        "--coverage.reportsDirectory=coverage",
        "--coverage.reporter=text",
        "--coverage.reporter=json",
        "--coverage.reporter=json-summary",
        "--coverage.reporter=html",
      ],
    },
    {
      name: "Unit tests + coverage (vitest direct fallback + explicit include set)",
      command: "npx",
      args: [
        "vitest",
        "run",
        "--coverage",
        "--no-file-parallelism",
        "--maxWorkers=1",
        "--coverage.provider=v8",
        "--coverage.reportsDirectory=coverage",
        "--coverage.include=tests/**/*.test.ts,server/**/*.test.ts",
        "--coverage.exclude=**/dist/**",
        "--coverage.reporter=json-summary",
        "--coverage.reporter=json",
      ],
    },
  ];

  cleanupCoverageArtifacts();

  let lastResult: GateCheckResult = runCommand(
    "coverage-initialization",
    "npm",
    ["--version"],
    true,
    env,
  );
  if (lastResult.status === "failed") {
    return lastResult;
  }

  for (let attempt = 0; attempt < coverageCommands.length; attempt += 1) {
    const candidate = coverageCommands[attempt];
    if (attempt > 0) {
      cleanupCoverageArtifacts();
      await sleep(COVERAGE_HEURISTIC_POLL_MS * attempt);
    }

    const result = runCommand(
      `${candidate.name} (attempt ${attempt + 1}/${coverageCommands.length})`,
      candidate.command,
      candidate.args,
      true,
      env,
    );
    lastResult = result;

    if (result.status === "passed") {
      break;
    }

    if (!result.details || !isRecoverableCoverageError(result.rawOutput || result.details)) {
      break;
    }

    if (attempt + 1 < coverageCommands.length) {
      console.warn(
        `[quality-gate] recoverable coverage failure detected on ${candidate.name}; ` +
          `switching strategy and retrying (${attempt + 1}/${COVERAGE_MAX_RETRIES})`,
      );
    }
  }

  if (lastResult.status === "passed" && fs.existsSync(COVERAGE_TEMP_DIR)) {
    try {
      const tempEntries = fs.readdirSync(COVERAGE_TEMP_DIR, { recursive: true });
      if (tempEntries.length === 0) {
        console.warn("[quality-gate] coverage finished but temp folder is empty");
      }
    } catch {
      // best effort telemetry only
    }
  }

  if (lastResult.status !== "passed" && isCoverageTempRaceError(lastResult.rawOutput || lastResult.details || "")) {
    console.warn(
      "[quality-gate] coverage command failed with file-system race patterns after retries; " +
      "manual review recommended.",
    );
  }

  return lastResult;
}

function parseCoverageSummary(): CoverageSummary | null {
  if (!fs.existsSync(COVERAGE_SUMMARY_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(COVERAGE_SUMMARY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const total = parsed?.total;
    if (!total) {
      return null;
    }

    const metricNames: CoverageMetricName[] = ["lines", "statements", "functions", "branches"];
    for (const metric of metricNames) {
      const pct = parseCoveragePercent(total[metric]?.pct);
      if (pct === null) {
        return null;
      }
    }

    return parsed as CoverageSummary;
  } catch (error) {
    console.error("[quality-gate] failed parsing coverage summary:", error);
    return null;
  }
}

function getLowestCoverageFiles(metric: CoverageMetricName, limit: number): string[] {
  if (!fs.existsSync(COVERAGE_FINAL_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(COVERAGE_FINAL_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const files = Object.entries(parsed)
      .map(([file, stats]) => {
        const pct = parseCoveragePercent((stats as any)?.[metric]?.pct);
        if (pct === null) {
          return null;
        }
        return {
          file,
          pct,
          covered: parseCoveragePercent((stats as any)?.[metric]?.covered),
          total: parseCoveragePercent((stats as any)?.[metric]?.total),
        };
      })
      .filter((entry): entry is { file: string; pct: number; covered?: number; total?: number } => entry !== null)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, limit);

    return files.map((entry) => `${entry.file} ${entry.pct.toFixed(2)}%`);
  } catch (error) {
    console.error("[quality-gate] failed reading coverage-final.json:", error);
    return [];
  }
}

function checkCoverageThresholds(thresholds: ThresholdConfig): GateCheckResult {
  const started = Date.now();
  const coverage = parseCoverageSummary();

  if (!coverage?.total) {
    return {
      name: "Coverage threshold check",
      command: "coverage-summary.json",
      status: "failed",
      durationMs: Date.now() - started,
      details: "coverage-summary.json not found or unreadable",
      exitCode: 1,
    };
  }

  const failures: string[] = [];
  const checks: Array<{ metric: CoverageMetricName; threshold: number; value: number }> = [
    { metric: "lines", threshold: thresholds.lines, value: coverage.total.lines.pct },
    { metric: "statements", threshold: thresholds.statements, value: coverage.total.statements.pct },
    { metric: "functions", threshold: thresholds.functions, value: coverage.total.functions.pct },
    { metric: "branches", threshold: thresholds.branches, value: coverage.total.branches.pct },
  ];

  for (const check of checks) {
    if (check.value < check.threshold) {
      failures.push(`${check.metric}: ${check.value.toFixed(2)}% < ${check.threshold}%`);
    }
  }

  if (failures.length === 0) {
    return {
      name: "Coverage threshold check",
      command: "coverage-summary.json",
      status: "passed",
      durationMs: Date.now() - started,
      exitCode: 0,
    };
  }

  const weakestFiles = Object.fromEntries(
    checks.map((check) => [
      check.metric,
      getLowestCoverageFiles(check.metric, FALLBACK_COVERAGE_CONTEXT),
    ]),
  );
  const weakestSummary = Object.entries(weakestFiles)
    .map(([metric, files]) => `${metric}: ${files.slice(0, 3).join("; ")}`)
    .join(" | ");

  return {
    name: "Coverage threshold check",
    command: "coverage-summary.json",
    status: "failed",
    durationMs: Date.now() - started,
    exitCode: 1,
    details: `${failures.join("; ")}; lowest-coverage samples => ${weakestSummary}`,
  };
}

function checkThresholdConfiguration(): GateCheckResult {
  const started = Date.now();
  const { diagnostics } = loadThresholds();
  const failures = diagnostics.filter((msg) => /must be|not numeric/.test(msg));
  const warnings = diagnostics.filter((msg) => !failures.includes(msg));

  if (failures.length === 0 && warnings.length === 0) {
    return {
      name: "Coverage threshold configuration",
      command: "ENV",
      status: "passed",
      durationMs: Date.now() - started,
      exitCode: 0,
    };
  }

  if (failures.length === 0) {
    return {
      name: "Coverage threshold configuration",
      command: "ENV",
      status: "passed",
      durationMs: Date.now() - started,
      details: `warnings: ${warnings.join("; ")}`,
    };
  }

  return {
    name: "Coverage threshold configuration",
    command: "ENV",
    status: "failed",
    durationMs: Date.now() - started,
    exitCode: 1,
    details: `invalid thresholds: ${failures.join("; ")}`,
  };
}

function buildReport(checks: GateCheckResult[], thresholds: ThresholdConfig) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;
  const report = {
    timestamp: new Date().toISOString(),
    thresholds,
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
  const { values: thresholds, diagnostics } = loadThresholds();
  const checks: GateCheckResult[] = [];
  const configCheck = checkThresholdConfiguration();
  checks.push(configCheck);

  if (configCheck.status === "failed") {
    const report = buildReport(checks, thresholds);
    console.error(`[quality-gate] blocked: configuration invalid (${report.summary.failed} failed checks).`);
    if (diagnostics.length > 0) {
      console.error(diagnostics.join("\n"));
    }
    process.exitCode = 1;
    return;
  }

  if (diagnostics.length > 0) {
    console.warn("[quality-gate] coverage thresholds loaded with warnings:");
    diagnostics.forEach((item) => console.warn(` - ${item}`));
  }

  // Allow CI/job environment to override defaults (defaults are only for local/empty env runs).
  const runEnv = { ...CI_DEFAULT_ENV, ...process.env };

  checks.push(runCommand("Type-check (application/runtime)", "npm", ["run", "type-check:app"], true, runEnv));
  checks.push(await runCoverageWithRetry(runEnv));
  checks.push(runCommand("Security baseline (npm audit)", "npm", ["audit", "--omit=dev", "--audit-level=high"], true, runEnv));
  checks.push(checkCoverageThresholds(thresholds));

  const report = buildReport(checks, thresholds);
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

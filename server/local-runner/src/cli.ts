#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { CliOptions, Plan } from "./types";
import { validateWorkspaceRoot } from "./policy";
import { runPlan } from "./steps/runner";
import { createLogger } from "./utils/logger";
import { loadPlan } from "./utils/plan";
import { createTelemetry } from "./utils/telemetry";

async function main(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .scriptName("iliagpt-run")
    .strict()
    .option("plan", {
      type: "string",
      demandOption: true,
      describe: "Path to plan JSON file",
    })
    .option("workspace", {
      type: "string",
      describe: "Workspace root directory (required unless plan.workspace is set)",
    })
    .option("allowlist", {
      type: "string",
      describe: "Optional allowlist JSON path",
    })
    .option("run-id", {
      type: "string",
      describe: "Override runId from plan",
    })
    .option("stream", {
      type: "boolean",
      default: false,
      describe: "Stream execution events as JSONL",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      describe: "Validate and plan actions without mutating files or running commands",
    })
    .option("yes", {
      type: "boolean",
      default: false,
      describe: "Auto-confirm risky actions (CI mode)",
    })
    .option("timeout-ms", {
      type: "number",
      default: 30_000,
      describe: "Default command timeout in milliseconds",
    })
    .option("max-output-bytes", {
      type: "number",
      default: 64 * 1024,
      describe: "Maximum captured output bytes per step",
    })
    .option("log", {
      type: "string",
      describe: "Audit log file path (default: workspace/.iliagpt/logs/<runId>.jsonl)",
    })
    .option("otel-endpoint", {
      type: "string",
      describe: "Optional OpenTelemetry endpoint (logs span envelope to stderr)",
    })
    .help()
    .parseSync();

  const planPath = path.resolve(argv.plan);
  if (!(await fs.pathExists(planPath))) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const plan = await loadPlan(planPath);
  const runId = argv["run-id"] ? String(argv["run-id"]) : plan.runId;
  if (!runId || !runId.trim()) {
    throw new Error("runId is required (plan.runId or --run-id)");
  }

  const selectedWorkspace = argv.workspace ?? plan.workspace;
  if (!selectedWorkspace) {
    throw new Error("workspace is required (--workspace or plan.workspace)");
  }

  const workspace = await validateWorkspaceRoot(selectedWorkspace);
  const logPath = argv.log
    ? path.resolve(String(argv.log))
    : path.join(workspace, ".iliagpt", "logs", `${runId}.jsonl`);

  const options: CliOptions = {
    planPath,
    workspace,
    stream: Boolean(argv.stream),
    dryRun: Boolean(argv["dry-run"]),
    autoConfirm: Boolean(argv.yes),
    logPath,
    allowlistPath: argv.allowlist ? path.resolve(String(argv.allowlist)) : undefined,
    timeoutMs: Number(argv["timeout-ms"]),
    maxOutputBytes: Number(argv["max-output-bytes"]),
    runIdOverride: argv["run-id"] ? String(argv["run-id"]) : undefined,
    otelEndpoint: argv["otel-endpoint"] ? String(argv["otel-endpoint"]) : undefined,
  };

  const logger = createLogger(logPath);
  const telemetry = createTelemetry(options.otelEndpoint);

  const runPlanPayload: Plan = {
    ...plan,
    runId,
  };

  logger.info({
    event: "run.started",
    runId,
    workspace,
    dryRun: options.dryRun,
    stream: options.stream,
    planPath,
  });

  const results = await runPlan({
    plan: runPlanPayload,
    workspace,
    stream: options.stream,
    dryRun: options.dryRun,
    autoConfirm: options.autoConfirm,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    allowlistPath: options.allowlistPath,
    logger,
    telemetry,
  });

  const summary = {
    runId,
    ok: results.filter((step) => step.status === "ok" || step.status === "cached").length,
    errors: results.filter((step) => step.status === "error").length,
    dryRun: results.filter((step) => step.status === "dry-run").length,
    total: results.length,
    logPath,
  };

  logger.info({ event: "run.finished", ...summary });
  await telemetry.shutdown();

  if (!options.stream) {
    process.stdout.write(`${JSON.stringify({ type: "summary", ...summary }, null, 2)}\n`);
  }

  if (summary.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const err = error as Error;
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});

import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import readline from "readline/promises";
import {
  AllowlistConfig,
  PlanStep,
  RunContext,
  StepResult,
  StreamEvent,
} from "../types";
import {
  createSafeEnv,
  isCommandAllowed,
  isCommandDangerous,
  resolveWorkspacePath,
} from "../policy";
import {
  acquireRunLock,
  loadRunResults,
  persistStepResult,
  releaseRunLock,
} from "../utils/idempotency";

const DEFAULT_ALLOWLIST: AllowlistConfig = {
  commands: ["pwd", "ls", "cat", "echo", "git status"],
  dangerous: ["rm", "ssh", "sudo", "scp", "curl", "wget"],
};

export async function runPlan(ctx: RunContext): Promise<StepResult[]> {
  const span = ctx.telemetry.startSpan("run_plan", {
    runId: ctx.plan.runId,
    stepCount: ctx.plan.steps.length,
  });

  const lock = await acquireRunLock(ctx.workspace, ctx.plan.runId);
  const allowlist = await loadAllowlist(ctx.allowlistPath);
  const stored = await loadRunResults(ctx.workspace, ctx.plan.runId);
  const results: StepResult[] = [];

  emitStream(ctx, {
    type: "run_started",
    runId: ctx.plan.runId,
    payload: { stepCount: ctx.plan.steps.length, dryRun: ctx.dryRun },
    timestamp: new Date().toISOString(),
  });

  try {
    for (const step of ctx.plan.steps) {
      if (!ctx.dryRun && stored.steps[step.id]?.result?.status === "ok") {
        const cached = {
          ...stored.steps[step.id].result,
          status: "cached",
          meta: {
            ...(stored.steps[step.id].result.meta ?? {}),
            cachedAt: stored.steps[step.id].updatedAt,
          },
        } as StepResult;
        results.push(cached);
        emitStepResult(ctx, step.id, cached);
        continue;
      }

      emitStream(ctx, {
        type: "step_started",
        runId: ctx.plan.runId,
        stepId: step.id,
        payload: { type: step.type },
        timestamp: new Date().toISOString(),
      });

      const result = await executeWithRetries(ctx, step, allowlist);
      results.push(result);

      if (!ctx.dryRun) {
        await persistStepResult(ctx.workspace, ctx.plan.runId, step.id, result);
      }

      emitStepResult(ctx, step.id, result);
    }

    emitStream(ctx, {
      type: "run_finished",
      runId: ctx.plan.runId,
      payload: {
        ok: results.filter((r) => r.status === "ok" || r.status === "cached").length,
        errors: results.filter((r) => r.status === "error").length,
      },
      timestamp: new Date().toISOString(),
    });

    span.end({ status: "ok" });
    return results;
  } catch (error) {
    const err = error as Error;
    ctx.logger.error({ event: "run.failed", runId: ctx.plan.runId, error: err.message });
    span.fail(err);
    throw err;
  } finally {
    await releaseRunLock(lock);
  }
}

async function executeWithRetries(
  ctx: RunContext,
  step: PlanStep,
  allowlist: AllowlistConfig,
): Promise<StepResult> {
  const retries = Math.max(0, step.retries ?? 0);
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= retries) {
    attempt += 1;
    try {
      const result = await executeSingle(ctx, step, allowlist);
      if (!result.meta) {
        result.meta = {};
      }
      result.meta.attempt = attempt;
      return result;
    } catch (error) {
      lastError = error as Error;
      ctx.logger.error({
        event: "step.attempt_failed",
        runId: ctx.plan.runId,
        stepId: step.id,
        attempt,
        error: lastError.message,
      });
      if (attempt > retries) {
        return {
          stepId: step.id,
          status: "error",
          error: lastError.message,
          meta: { attempts: attempt },
        };
      }
    }
  }

  return {
    stepId: step.id,
    status: "error",
    error: lastError?.message ?? "Unknown step failure",
    meta: { attempts: attempt },
  };
}

async function executeSingle(
  ctx: RunContext,
  step: PlanStep,
  allowlist: AllowlistConfig,
): Promise<StepResult> {
  const stepSpan = ctx.telemetry.startSpan("step", {
    runId: ctx.plan.runId,
    stepId: step.id,
    stepType: step.type,
  });

  try {
    let result: StepResult;
    switch (step.type) {
      case "list_dir":
        result = await handleListDir(ctx, step);
        break;
      case "read_file":
        result = await handleReadFile(ctx, step);
        break;
      case "write_file":
        result = await handleWriteFile(ctx, step);
        break;
      case "run_command_allowlisted":
        result = await handleRunCommand(ctx, step, allowlist);
        break;
      case "upload_artifact":
        result = await handleUploadArtifact(ctx, step);
        break;
      case "download_artifact":
        result = await handleDownloadArtifact(ctx, step);
        break;
      default:
        throw new Error(`Unsupported step type: ${step.type}`);
    }

    ctx.logger.info({
      event: "step.completed",
      runId: ctx.plan.runId,
      stepId: step.id,
      status: result.status,
    });
    stepSpan.end({ status: result.status });
    return result;
  } catch (error) {
    const err = error as Error;
    stepSpan.fail(err);
    throw err;
  }
}

async function handleListDir(ctx: RunContext, step: PlanStep): Promise<StepResult> {
  const requested = asString(step.args.path, ".");
  const resolved = await resolveWorkspacePath(ctx.workspace, requested);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const out = entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
  }));

  return {
    stepId: step.id,
    status: "ok",
    output: limitJson(out, ctx.maxOutputBytes),
  };
}

async function handleReadFile(ctx: RunContext, step: PlanStep): Promise<StepResult> {
  const requested = asString(step.args.path);
  const resolved = await resolveWorkspacePath(ctx.workspace, requested);
  const exists = await fs.pathExists(resolved);
  if (!exists) {
    throw new Error(`File not found: ${requested}`);
  }

  const content = await fs.readFile(resolved);
  const limited = limitBuffer(content, ctx.maxOutputBytes);

  return {
    stepId: step.id,
    status: "ok",
    output: limited.text,
    meta: {
      bytes: content.byteLength,
      truncated: limited.truncated,
    },
  };
}

async function handleWriteFile(ctx: RunContext, step: PlanStep): Promise<StepResult> {
  const requested = asString(step.args.path);
  const resolved = await resolveWorkspacePath(ctx.workspace, requested);
  const content = asString(step.args.content, "");

  if (step.confirm && !ctx.autoConfirm) {
    await confirmAction(`write file '${requested}'`, step.id);
  }

  if (ctx.dryRun) {
    return {
      stepId: step.id,
      status: "dry-run",
      meta: { action: "write_file", path: requested, bytes: Buffer.byteLength(content) },
    };
  }

  await fs.ensureDir(path.dirname(resolved));
  await fs.writeFile(resolved, content, "utf-8");

  return {
    stepId: step.id,
    status: "ok",
    output: { path: requested, bytes: Buffer.byteLength(content) },
  };
}

async function handleRunCommand(
  ctx: RunContext,
  step: PlanStep,
  allowlist: AllowlistConfig,
): Promise<StepResult> {
  const command = asString(step.args.command);
  if (!isCommandAllowed(command, allowlist.commands)) {
    throw new Error(`Command blocked by allowlist: ${command}`);
  }

  const dangerous = isCommandDangerous(command, allowlist.dangerous);
  if ((dangerous || step.confirm) && !ctx.autoConfirm) {
    await confirmAction(`run command '${command}'`, step.id);
  }

  if (ctx.dryRun) {
    return {
      stepId: step.id,
      status: "dry-run",
      meta: {
        action: "run_command_allowlisted",
        command,
      },
    };
  }

  const timeoutMs = asNumber(step.args.timeoutMs, ctx.timeoutMs);
  const maxOutputBytes = asNumber(step.args.maxOutputBytes, ctx.maxOutputBytes);

  const output = await runCommand(command, {
    cwd: ctx.workspace,
    timeoutMs,
    maxOutputBytes,
  });

  if (output.timedOut) {
    throw new Error(`Command timed out after ${timeoutMs}ms`);
  }
  if (output.code !== 0) {
    throw new Error(`Command failed with code ${output.code}: ${output.output}`);
  }

  return {
    stepId: step.id,
    status: "ok",
    output: output.output,
    meta: {
      code: output.code,
      timedOut: output.timedOut,
      truncated: output.truncated,
      timeoutMs,
      maxOutputBytes,
    },
  };
}

async function handleUploadArtifact(ctx: RunContext, step: PlanStep): Promise<StepResult> {
  const requested = asString(step.args.path);
  const source = await resolveWorkspacePath(ctx.workspace, requested);
  const artifactName = safeArtifactName(asString(step.args.name, path.basename(source)));
  const artifactDir = path.join(ctx.workspace, ".iliagpt", "artifacts");
  const localCopy = path.join(artifactDir, artifactName);

  if (step.confirm && !ctx.autoConfirm) {
    await confirmAction(`upload artifact '${requested}'`, step.id);
  }

  if (ctx.dryRun) {
    return {
      stepId: step.id,
      status: "dry-run",
      meta: { action: "upload_artifact", source: requested, artifactName },
    };
  }

  await fs.ensureDir(artifactDir);
  await fs.copy(source, localCopy);

  const url = maybeString(step.args.url);
  if (url) {
    const body = await fs.readFile(localCopy);
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    if (!response.ok) {
      throw new Error(`Artifact upload failed with status ${response.status}`);
    }
  }

  return {
    stepId: step.id,
    status: "ok",
    output: {
      cachedPath: localCopy,
      uploaded: Boolean(url),
      url: url ?? null,
    },
  };
}

async function handleDownloadArtifact(ctx: RunContext, step: PlanStep): Promise<StepResult> {
  const requested = asString(step.args.path);
  const targetPath = await resolveWorkspacePath(ctx.workspace, requested);
  const artifactName = safeArtifactName(asString(step.args.name, path.basename(targetPath)));
  const artifactDir = path.join(ctx.workspace, ".iliagpt", "artifacts");
  const cachedPath = path.join(artifactDir, artifactName);

  if (step.confirm && !ctx.autoConfirm) {
    await confirmAction(`download artifact to '${requested}'`, step.id);
  }

  if (ctx.dryRun) {
    return {
      stepId: step.id,
      status: "dry-run",
      meta: { action: "download_artifact", target: requested, artifactName },
    };
  }

  await fs.ensureDir(path.dirname(targetPath));
  await fs.ensureDir(artifactDir);

  const url = maybeString(step.args.url);
  if (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Artifact download failed with status ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(cachedPath, buffer);
    await fs.writeFile(targetPath, buffer);
  } else {
    const exists = await fs.pathExists(cachedPath);
    if (!exists) {
      throw new Error(`Artifact not found in local cache: ${artifactName}`);
    }
    await fs.copy(cachedPath, targetPath);
  }

  return {
    stepId: step.id,
    status: "ok",
    output: {
      targetPath,
      cachedPath,
      downloaded: Boolean(url),
      url: url ?? null,
    },
  };
}

async function loadAllowlist(overridePath?: string): Promise<AllowlistConfig> {
  const candidates = [
    overridePath,
    path.resolve(__dirname, "../../configs/allowlist.json"),
    path.resolve(process.cwd(), "server/local-runner/configs/allowlist.json"),
    path.resolve(process.cwd(), "configs/allowlist.json"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      const parsed = (await fs.readJson(candidate)) as Partial<AllowlistConfig>;
      return {
        commands: Array.isArray(parsed.commands) ? parsed.commands : DEFAULT_ALLOWLIST.commands,
        dangerous: Array.isArray(parsed.dangerous) ? parsed.dangerous : DEFAULT_ALLOWLIST.dangerous,
      };
    }
  }

  return DEFAULT_ALLOWLIST;
}

async function confirmAction(action: string, stepId: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `Confirmation required for step '${stepId}': ${action}. Continue? (y/N) `,
    );
    if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
      throw new Error(`Action rejected by user: ${action}`);
    }
  } finally {
    rl.close();
  }
}

async function runCommand(
  command: string,
  options: { cwd: string; timeoutMs: number; maxOutputBytes: number },
): Promise<{ code: number; output: string; timedOut: boolean; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      env: createSafeEnv(options.cwd),
    });

    let combined = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const appendOutput = (chunk: Buffer) => {
      if (settled) {
        return;
      }
      combined = Buffer.concat([combined, chunk]);
      if (combined.byteLength > options.maxOutputBytes) {
        combined = combined.subarray(0, options.maxOutputBytes);
        truncated = true;
        child.kill("SIGTERM");
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      appendOutput(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      appendOutput(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        output: combined.toString("utf-8"),
        timedOut,
        truncated,
      });
    });
  });
}

function emitStepResult(ctx: RunContext, stepId: string, result: StepResult): void {
  emitStream(ctx, {
    type: "step_result",
    runId: ctx.plan.runId,
    stepId,
    payload: result,
    timestamp: new Date().toISOString(),
  });
}

function emitStream(ctx: RunContext, event: StreamEvent): void {
  if (!ctx.stream) {
    return;
  }
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function asString(value: unknown, fallback?: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error("Missing required string argument");
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function safeArtifactName(name: string): string {
  const base = path.basename(name);
  if (!base || base !== name || base === "." || base === "..") {
    throw new Error("Invalid artifact name");
  }
  return base;
}

function limitBuffer(buffer: Buffer, maxBytes: number): { text: string; truncated: boolean } {
  if (buffer.byteLength <= maxBytes) {
    return {
      text: buffer.toString("utf-8"),
      truncated: false,
    };
  }
  return {
    text: buffer.subarray(0, maxBytes).toString("utf-8"),
    truncated: true,
  };
}

function limitJson(value: unknown, maxBytes: number): unknown {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return value;
  }
  const truncated = Buffer.from(text, "utf-8").subarray(0, maxBytes).toString("utf-8");
  return {
    truncated: true,
    output: truncated,
  };
}

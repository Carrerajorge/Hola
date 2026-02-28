"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlan = runPlan;
const child_process_1 = require("child_process");
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("readline/promises"));
const policy_1 = require("../policy");
const idempotency_1 = require("../utils/idempotency");
const DEFAULT_ALLOWLIST = {
    commands: ["pwd", "ls", "cat", "echo", "git status"],
    dangerous: ["rm", "ssh", "sudo", "scp", "curl", "wget"],
};
async function runPlan(ctx) {
    const span = ctx.telemetry.startSpan("run_plan", {
        runId: ctx.plan.runId,
        stepCount: ctx.plan.steps.length,
    });
    const lock = await (0, idempotency_1.acquireRunLock)(ctx.workspace, ctx.plan.runId);
    const allowlist = await loadAllowlist(ctx.allowlistPath);
    const stored = await (0, idempotency_1.loadRunResults)(ctx.workspace, ctx.plan.runId);
    const results = [];
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
                };
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
                await (0, idempotency_1.persistStepResult)(ctx.workspace, ctx.plan.runId, step.id, result);
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
    }
    catch (error) {
        const err = error;
        ctx.logger.error({ event: "run.failed", runId: ctx.plan.runId, error: err.message });
        span.fail(err);
        throw err;
    }
    finally {
        await (0, idempotency_1.releaseRunLock)(lock);
    }
}
async function executeWithRetries(ctx, step, allowlist) {
    const retries = Math.max(0, step.retries ?? 0);
    let attempt = 0;
    let lastError;
    while (attempt <= retries) {
        attempt += 1;
        try {
            const result = await executeSingle(ctx, step, allowlist);
            if (!result.meta) {
                result.meta = {};
            }
            result.meta.attempt = attempt;
            return result;
        }
        catch (error) {
            lastError = error;
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
async function executeSingle(ctx, step, allowlist) {
    const stepSpan = ctx.telemetry.startSpan("step", {
        runId: ctx.plan.runId,
        stepId: step.id,
        stepType: step.type,
    });
    try {
        let result;
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
    }
    catch (error) {
        const err = error;
        stepSpan.fail(err);
        throw err;
    }
}
async function handleListDir(ctx, step) {
    const requested = asString(step.args.path, ".");
    const resolved = await (0, policy_1.resolveWorkspacePath)(ctx.workspace, requested);
    const entries = await fs_extra_1.default.readdir(resolved, { withFileTypes: true });
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
async function handleReadFile(ctx, step) {
    const requested = asString(step.args.path);
    const resolved = await (0, policy_1.resolveWorkspacePath)(ctx.workspace, requested);
    const exists = await fs_extra_1.default.pathExists(resolved);
    if (!exists) {
        throw new Error(`File not found: ${requested}`);
    }
    const content = await fs_extra_1.default.readFile(resolved);
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
async function handleWriteFile(ctx, step) {
    const requested = asString(step.args.path);
    const resolved = await (0, policy_1.resolveWorkspacePath)(ctx.workspace, requested);
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
    await fs_extra_1.default.ensureDir(path_1.default.dirname(resolved));
    await fs_extra_1.default.writeFile(resolved, content, "utf-8");
    return {
        stepId: step.id,
        status: "ok",
        output: { path: requested, bytes: Buffer.byteLength(content) },
    };
}
async function handleRunCommand(ctx, step, allowlist) {
    const command = asString(step.args.command);
    if (!(0, policy_1.isCommandAllowed)(command, allowlist.commands)) {
        throw new Error(`Command blocked by allowlist: ${command}`);
    }
    const dangerous = (0, policy_1.isCommandDangerous)(command, allowlist.dangerous);
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
async function handleUploadArtifact(ctx, step) {
    const requested = asString(step.args.path);
    const source = await (0, policy_1.resolveWorkspacePath)(ctx.workspace, requested);
    const artifactName = safeArtifactName(asString(step.args.name, path_1.default.basename(source)));
    const artifactDir = path_1.default.join(ctx.workspace, ".iliagpt", "artifacts");
    const localCopy = path_1.default.join(artifactDir, artifactName);
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
    await fs_extra_1.default.ensureDir(artifactDir);
    await fs_extra_1.default.copy(source, localCopy);
    const url = maybeString(step.args.url);
    if (url) {
        const body = await fs_extra_1.default.readFile(localCopy);
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
async function handleDownloadArtifact(ctx, step) {
    const requested = asString(step.args.path);
    const targetPath = await (0, policy_1.resolveWorkspacePath)(ctx.workspace, requested);
    const artifactName = safeArtifactName(asString(step.args.name, path_1.default.basename(targetPath)));
    const artifactDir = path_1.default.join(ctx.workspace, ".iliagpt", "artifacts");
    const cachedPath = path_1.default.join(artifactDir, artifactName);
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
    await fs_extra_1.default.ensureDir(path_1.default.dirname(targetPath));
    await fs_extra_1.default.ensureDir(artifactDir);
    const url = maybeString(step.args.url);
    if (url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Artifact download failed with status ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs_extra_1.default.writeFile(cachedPath, buffer);
        await fs_extra_1.default.writeFile(targetPath, buffer);
    }
    else {
        const exists = await fs_extra_1.default.pathExists(cachedPath);
        if (!exists) {
            throw new Error(`Artifact not found in local cache: ${artifactName}`);
        }
        await fs_extra_1.default.copy(cachedPath, targetPath);
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
async function loadAllowlist(overridePath) {
    const candidates = [
        overridePath,
        path_1.default.resolve(__dirname, "../../configs/allowlist.json"),
        path_1.default.resolve(process.cwd(), "server/local-runner/configs/allowlist.json"),
        path_1.default.resolve(process.cwd(), "configs/allowlist.json"),
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (await fs_extra_1.default.pathExists(candidate)) {
            const parsed = (await fs_extra_1.default.readJson(candidate));
            return {
                commands: Array.isArray(parsed.commands) ? parsed.commands : DEFAULT_ALLOWLIST.commands,
                dangerous: Array.isArray(parsed.dangerous) ? parsed.dangerous : DEFAULT_ALLOWLIST.dangerous,
            };
        }
    }
    return DEFAULT_ALLOWLIST;
}
async function confirmAction(action, stepId) {
    const rl = promises_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const answer = await rl.question(`Confirmation required for step '${stepId}': ${action}. Continue? (y/N) `);
        if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
            throw new Error(`Action rejected by user: ${action}`);
        }
    }
    finally {
        rl.close();
    }
}
async function runCommand(command, options) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(command, {
            cwd: options.cwd,
            shell: true,
            env: (0, policy_1.createSafeEnv)(options.cwd),
        });
        let combined = Buffer.alloc(0);
        let truncated = false;
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, options.timeoutMs);
        const appendOutput = (chunk) => {
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
        child.stdout.on("data", (chunk) => {
            appendOutput(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        child.stderr.on("data", (chunk) => {
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
function emitStepResult(ctx, stepId, result) {
    emitStream(ctx, {
        type: "step_result",
        runId: ctx.plan.runId,
        stepId,
        payload: result,
        timestamp: new Date().toISOString(),
    });
}
function emitStream(ctx, event) {
    if (!ctx.stream) {
        return;
    }
    process.stdout.write(`${JSON.stringify(event)}\n`);
}
function asString(value, fallback) {
    if (typeof value === "string") {
        return value;
    }
    if (fallback !== undefined) {
        return fallback;
    }
    throw new Error("Missing required string argument");
}
function maybeString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function asNumber(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }
    return fallback;
}
function safeArtifactName(name) {
    const base = path_1.default.basename(name);
    if (!base || base !== name || base === "." || base === "..") {
        throw new Error("Invalid artifact name");
    }
    return base;
}
function limitBuffer(buffer, maxBytes) {
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
function limitJson(value, maxBytes) {
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

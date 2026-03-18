import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../../agent/toolRegistry";
import { getClawiCatalog } from "../fusion/clawiCatalog";

const DEFAULT_CLAWI_ROOT = path.resolve(process.cwd(), "server", "openclaw");
const MAX_CAPTURE_BYTES = 1_000_000;

function resolveClawiRoot(): string {
  return process.env.CLAWI_ROOT_DIR
    ? path.resolve(process.env.CLAWI_ROOT_DIR)
    : DEFAULT_CLAWI_ROOT;
}

async function existsAsFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function existsAsDir(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return {
    success: false,
    output: null,
    error: { code, message, retryable },
  };
}

function capText(input: string): string {
  return input.length <= MAX_CAPTURE_BYTES
    ? input
    : `${input.slice(0, MAX_CAPTURE_BYTES)}\n...(truncated)`;
}

async function runClawiCommand(params: {
  rootDir: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const proc = spawn("node", ["openclaw.mjs", ...params.args], {
      cwd: params.rootDir,
      env: {
        ...process.env,
        OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE || "dev",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const timeout = setTimeout(() => {
      killedByTimeout = true;
      proc.kill("SIGTERM");
    }, params.timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.length > MAX_CAPTURE_BYTES) {
        stdout = stdout.slice(-MAX_CAPTURE_BYTES);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
      if (stderr.length > MAX_CAPTURE_BYTES) {
        stderr = stderr.slice(-MAX_CAPTURE_BYTES);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: !killedByTimeout && code === 0,
        code,
        stdout: capText(stdout),
        stderr: capText(stderr),
      });
    });
  });
}

const clawiStatusTool: ToolDefinition = {
  name: "openclaw_clawi_status",
  description:
    "Inspect local integrated OpenClaw runtime status (repo availability, skills, extensions, tools).",
  inputSchema: z.object({}),
  execute: async (): Promise<ToolResult> => {
    try {
      const rootDir = resolveClawiRoot();
      const openclawEntry = path.join(rootDir, "openclaw.mjs");
      const nodeModulesDir = path.join(rootDir, "node_modules");
      const [repoExists, entryExists, nodeModulesExists, catalog] = await Promise.all([
        existsAsDir(rootDir),
        existsAsFile(openclawEntry),
        existsAsDir(nodeModulesDir),
        getClawiCatalog(),
      ]);

      return {
        success: true,
        output: {
          rootDir,
          repoExists,
          openclawEntryExists: entryExists,
          nodeModulesExists,
          skillsCount: catalog.skills.length,
          extensionsCount: catalog.extensions.length,
          agentToolsCount: catalog.agentTools.length,
          loadedAt: catalog.loadedAt,
        },
      };
    } catch (error: any) {
      return fail("CLAWI_STATUS_ERROR", error?.message || "Failed to inspect OpenClaw status", true);
    }
  },
};

const clawiExecTool: ToolDefinition = {
  name: "openclaw_clawi_exec",
  description:
    "Execute integrated OpenClaw CLI commands from the local vendor tree (no HTTP API).",
  inputSchema: z.object({
    args: z.array(z.string().min(1)).min(1).max(32),
    timeoutMs: z.number().int().min(1_000).max(300_000).optional().default(120_000),
  }),
  capabilities: ["long_running", "high_risk"],
  execute: async (input: any): Promise<ToolResult> => {
    try {
      const rootDir = resolveClawiRoot();
      if (!(await existsAsDir(rootDir))) {
        return fail("CLAWI_ROOT_NOT_FOUND", `OpenClaw root not found: ${rootDir}`);
      }
      if (!(await existsAsFile(path.join(rootDir, "openclaw.mjs")))) {
        return fail("CLAWI_ENTRY_NOT_FOUND", `openclaw.mjs not found in ${rootDir}`);
      }

      const result = await runClawiCommand({
        rootDir,
        args: input.args,
        timeoutMs: input.timeoutMs,
      });

      if (!result.ok) {
        return fail(
          "CLAWI_EXEC_FAILED",
          `OpenClaw CLI failed (code=${String(result.code)}). stderr: ${result.stderr || "(empty)"}`,
          true,
        );
      }

      return {
        success: true,
        output: {
          code: result.code,
          stdout: result.stdout,
          stderr: result.stderr,
          args: input.args,
        },
      };
    } catch (error: any) {
      return fail("CLAWI_EXEC_ERROR", error?.message || "Failed to execute OpenClaw runtime", true);
    }
  },
};

export function createClawiRuntimeTools(): ToolDefinition[] {
  return [clawiStatusTool, clawiExecTool];
}

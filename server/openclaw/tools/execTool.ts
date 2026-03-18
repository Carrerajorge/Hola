import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../../agent/toolRegistry";
import { ToolPolicyEngine } from "./toolPolicies";

const ExecInputSchema = z.object({
  command: z.string().min(1).describe("Shell command to execute"),
  cwd: z.string().optional().describe("Working directory (within workspace)"),
  timeout: z.number().optional().describe("Timeout in ms (overrides default)"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
});

export function createExecTool(policy: ToolPolicyEngine, workspaceRoot: string): ToolDefinition {
  return {
    name: "openclaw_exec",
    description:
      "Execute a shell command securely with safe-bins policy and workspace isolation.",
    inputSchema: ExecInputSchema,
    capabilities: ["executes_code", "high_risk"],
    execute: async (
      input: z.infer<typeof ExecInputSchema>,
      context: ToolContext,
    ): Promise<ToolResult> => {
      const check = policy.isCommandAllowed(input.command);
      if (!check.allowed) {
        return {
          success: false,
          output: null,
          error: {
            code: "BLOCKED",
            message: `Command blocked: ${check.reason}`,
            retryable: false,
            details: { binary: check.binary, command: input.command },
          },
        };
      }

      await fs.mkdir(workspaceRoot, { recursive: true });
      const effectiveCwd = input.cwd ? path.resolve(workspaceRoot, input.cwd) : workspaceRoot;
      if (!effectiveCwd.startsWith(path.resolve(workspaceRoot))) {
        return {
          success: false,
          output: null,
          error: {
            code: "BLOCKED",
            message: "Working directory escapes workspace root",
            retryable: false,
          },
        };
      }

      await fs.mkdir(effectiveCwd, { recursive: true });
      const effectiveTimeout = input.timeout || policy.timeout;
      const startedAt = Date.now();

      return await new Promise<ToolResult>((resolve) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let killed = false;

        const proc = spawn("sh", ["-c", input.command], {
          cwd: effectiveCwd,
          env: { ...process.env, ...input.env, HOME: workspaceRoot },
          signal: context.signal,
        });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill("SIGKILL");
        }, effectiveTimeout);

        proc.stdout.on("data", (chunk: Buffer) => {
          stdout.push(chunk);
          context.onStream?.({ stream: "stdout", chunk: chunk.toString() });
        });

        proc.stderr.on("data", (chunk: Buffer) => {
          stderr.push(chunk);
          context.onStream?.({ stream: "stderr", chunk: chunk.toString() });
        });

        proc.on("close", (exitCode, signal) => {
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const stdoutText = Buffer.concat(stdout).toString().slice(0, 100_000);
          const stderrText = Buffer.concat(stderr).toString().slice(0, 50_000);

          context.onExit?.({
            exitCode: exitCode ?? -1,
            signal: signal ?? null,
            wasKilled: killed,
            durationMs,
          });

          if (killed) {
            resolve({
              success: false,
              output: stdoutText,
              error: {
                code: "TIMEOUT",
                message: `Command timed out after ${effectiveTimeout}ms`,
                retryable: true,
                details: { stderr: stderrText },
              },
              metrics: { durationMs: effectiveTimeout },
            });
            return;
          }

          resolve({
            success: exitCode === 0,
            output: stdoutText || stderrText,
            error:
              exitCode === 0
                ? undefined
                : {
                    code: "EXIT_CODE",
                    message: `Command exited with code ${exitCode}`,
                    retryable: true,
                    details: { exitCode, stderr: stderrText },
                  },
            metrics: { durationMs },
          });
        });

        proc.on("error", (error: Error) => {
          clearTimeout(timer);
          resolve({
            success: false,
            output: null,
            error: {
              code: "SPAWN_ERROR",
              message: error.message,
              retryable: false,
            },
          });
        });
      });
    },
  };
}

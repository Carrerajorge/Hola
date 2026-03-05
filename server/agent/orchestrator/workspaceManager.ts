// server/agent/orchestrator/workspaceManager.ts
// ---------------------------------------------------------------------------
// Per-run workspace manager for the SuperPlanner executor.
// Creates isolated /tmp/orchestrator-{runId}/ directories, instantiates
// OpenClaw file tools and exec tool, manages cleanup.
// ---------------------------------------------------------------------------

import path from "path";
import fs from "fs/promises";
import { createFsTools } from "../../openclaw/tools/fsTool";
import { createExecTool } from "../../openclaw/tools/execTool";
import { ToolPolicyEngine } from "../../openclaw/tools/toolPolicies";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";

// ---------------------------------------------------------------------------
// Safe binaries the orchestrator is allowed to execute
// ---------------------------------------------------------------------------

const ORCHESTRATOR_SAFE_BINS = [
  "node", "npm", "npx", "pnpm", "bun",
  "python", "python3", "pip", "pip3",
  "git", "curl", "wget",
  "ls", "cat", "head", "tail", "wc", "grep", "find",
  "mkdir", "cp", "mv", "rm", "chmod", "touch",
  "tar", "unzip", "gzip",
  "echo", "printf", "tee", "sort", "uniq", "diff",
  "sh", "bash",
];

// ---------------------------------------------------------------------------
// Workspace type
// ---------------------------------------------------------------------------

export interface OrchestratorWorkspace {
  runId: string;
  root: string;
  fsTools: ToolDefinition[];
  execTool: ToolDefinition;
  policy: ToolPolicyEngine;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// In-memory workspace cache (one per runId)
// ---------------------------------------------------------------------------

const workspaces = new Map<string, OrchestratorWorkspace>();

// ---------------------------------------------------------------------------
// getOrCreateWorkspace — main entry point
// ---------------------------------------------------------------------------

export async function getOrCreateWorkspace(
  runId: string,
): Promise<OrchestratorWorkspace> {
  const existing = workspaces.get(runId);
  if (existing) return existing;

  const root = path.join("/tmp", `orchestrator-${runId}`);
  await fs.mkdir(root, { recursive: true });

  const policy = new ToolPolicyEngine({
    safeBins: ORCHESTRATOR_SAFE_BINS,
    security: "allow",
    timeout: 30_000,
  });

  const fsTools = createFsTools(root, true);
  const execTool = createExecTool(policy, root);

  const workspace: OrchestratorWorkspace = {
    runId,
    root,
    fsTools,
    execTool,
    policy,
    createdAt: Date.now(),
  };

  workspaces.set(runId, workspace);
  return workspace;
}

// ---------------------------------------------------------------------------
// Helper: execute a workspace file tool by name
// ---------------------------------------------------------------------------

export async function execWorkspaceTool(
  workspace: OrchestratorWorkspace,
  toolName: string,
  input: Record<string, any>,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const allTools = [...workspace.fsTools, workspace.execTool];
  const tool = allTools.find((t) => t.name === toolName);
  if (!tool) {
    return {
      success: false,
      output: null,
      error: { code: "NOT_FOUND", message: `Tool ${toolName} not found`, retryable: false },
    };
  }

  const ctx: ToolContext = {
    userId: "orchestrator",
    chatId: workspace.runId,
    runId: workspace.runId,
    signal: signal || new AbortController().signal,
  };

  return await tool.execute(input, ctx);
}

// ---------------------------------------------------------------------------
// listWorkspaceFiles — utility to get all files in workspace
// ---------------------------------------------------------------------------

export async function listWorkspaceFiles(
  workspace: OrchestratorWorkspace,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          await walk(fullPath);
        }
      } else {
        files.push(path.relative(workspace.root, fullPath));
      }
    }
  }

  try {
    await walk(workspace.root);
  } catch { /* workspace may be empty */ }

  return files;
}

// ---------------------------------------------------------------------------
// cleanupWorkspace — remove workspace directory and cache entry
// ---------------------------------------------------------------------------

export async function cleanupWorkspace(runId: string): Promise<void> {
  const workspace = workspaces.get(runId);
  if (!workspace) return;

  try {
    await fs.rm(workspace.root, { recursive: true, force: true });
  } catch { /* best effort */ }

  workspaces.delete(runId);
}

// ---------------------------------------------------------------------------
// cleanupStaleWorkspaces — remove workspaces older than maxAge
// ---------------------------------------------------------------------------

export async function cleanupStaleWorkspaces(maxAgeMs = 3600_000): Promise<number> {
  const now = Date.now();
  let cleaned = 0;

  for (const [runId, ws] of workspaces) {
    if (now - ws.createdAt > maxAgeMs) {
      await cleanupWorkspace(runId);
      cleaned++;
    }
  }

  return cleaned;
}

import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../toolRegistry";
import {
  AGENT_ECOSYSTEM_SERVICE_IDS,
  agentEcosystemService,
  type AgentEcosystemComposeAction,
  type AgentEcosystemHttpMethod,
} from "../../services/agentEcosystemService";

const serviceEnum = z.enum(AGENT_ECOSYSTEM_SERVICE_IDS);
const methodEnum = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const composeActionEnum = z.enum(["up", "down", "ps", "logs", "restart"]);

const ecosystemStatusSchema = z.object({
  live: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(500).max(30000).optional().default(4000),
});

const ecosystemProxySchema = z.object({
  service: serviceEnum,
  method: methodEnum.optional().default("GET"),
  path: z.string().optional().default("/"),
  query: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(500).max(120000).optional().default(15000),
});

const ecosystemComposeSchema = z.object({
  action: composeActionEnum,
  profiles: z.array(z.string().trim().min(1)).optional(),
  services: z.array(z.string().trim().min(1)).optional(),
  follow: z.boolean().optional().default(false),
  lines: z.number().int().min(1).max(2000).optional().default(200),
  timeoutMs: z.number().int().min(1000).max(900000).optional().default(120000),
});

const ecosystemScriptSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(900000).optional().default(300000),
});

const ecosystemRepoExecSchema = z.object({
  repo: z.string().trim().min(1).max(120),
  command: z.string().trim().min(1).max(64),
  args: z.array(z.string().min(1).max(4000)).max(64).optional(),
  timeoutMs: z.number().int().min(1000).max(900000).optional().default(120000),
  env: z.record(z.string().max(4000)).optional(),
});

const ecosystemRepoSearchSchema = z.object({
  repo: z.string().trim().min(1).max(120).optional(),
  pattern: z.string().trim().min(1).max(300),
  glob: z.string().trim().min(1).max(256).optional(),
  maxResults: z.number().int().min(1).max(1000).optional().default(80),
  timeoutMs: z.number().int().min(1000).max(600000).optional().default(60000),
});

const ecosystemRepoReadSchema = z.object({
  repo: z.string().trim().min(1).max(120),
  filePath: z.string().trim().min(1).max(500),
  maxBytes: z.number().int().min(1000).max(2000000).optional().default(200000),
});

const ecosystemRepoProbeSchema = z.object({
  repo: z.string().trim().min(1).max(120).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional().default(10000),
  maxRepos: z.number().int().min(1).max(5000).optional().default(200),
});

const ecosystemDeepAuditSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(120000).optional().default(6000),
  maxRepos: z.number().int().min(1).max(5000).optional().default(200),
  includeAdapters: z.boolean().optional().default(true),
  includeRuntime: z.boolean().optional().default(true),
  includeSmoke: z.boolean().optional().default(true),
  concurrency: z.number().int().min(1).max(12).optional().default(4),
});

function toolFailure(
  code: string,
  message: string,
  startedAtMs: number,
  retryable = false,
): ToolResult {
  return {
    success: false,
    output: null,
    error: {
      code,
      message,
      retryable,
    },
    metrics: { durationMs: Date.now() - startedAtMs },
  };
}

async function executeStatusTool(
  input: { live?: boolean; timeoutMs?: number },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const status = await agentEcosystemService.getFusionStatus({
      live: Boolean(input.live),
      timeoutMs: input.timeoutMs,
    });
    return {
      success: true,
      output: status,
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_STATUS_ERROR",
      error?.message || "Failed to collect ecosystem status",
      startedAtMs,
    );
  }
}

async function executeProxyTool(
  input: {
    service: string;
    method?: AgentEcosystemHttpMethod;
    path?: string;
    query?: Record<string, string | number | boolean | null>;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.proxyRequest({
      service: input.service as any,
      method: input.method,
      path: input.path,
      query: input.query,
      headers: input.headers,
      body: input.body,
      timeoutMs: input.timeoutMs,
    });
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_PROXY_HTTP_ERROR",
            message: `Service returned status ${result.status}`,
            retryable: result.status >= 500,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    const message = String(error?.message || "Proxy request failed");
    if (message.includes("service_proxy_disabled")) {
      return toolFailure(
        "AGENT_ECOSYSTEM_PROXY_DISABLED",
        message,
        startedAtMs,
        false,
      );
    }
    return toolFailure(
      "AGENT_ECOSYSTEM_PROXY_ERROR",
      message,
      startedAtMs,
      true,
    );
  }
}

async function executeComposeTool(
  input: {
    action: AgentEcosystemComposeAction;
    profiles?: string[];
    services?: string[];
    follow?: boolean;
    lines?: number;
    timeoutMs?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.runCompose({
      action: input.action,
      profiles: input.profiles,
      services: input.services,
      follow: input.follow,
      lines: input.lines,
      timeoutMs: input.timeoutMs,
    });
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_COMPOSE_ERROR",
            message: result.stderr || `Compose command failed (exit=${result.exitCode})`,
            retryable: true,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_COMPOSE_ERROR",
      error?.message || "Compose action failed",
      startedAtMs,
      true,
    );
  }
}

async function executeSyncTool(
  input: { timeoutMs?: number },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.syncRepos(input.timeoutMs);
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_SYNC_ERROR",
            message: result.stderr || "Repository sync failed",
            retryable: true,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_SYNC_ERROR",
      error?.message || "Repository sync failed",
      startedAtMs,
      true,
    );
  }
}

async function executeRepoExecTool(
  input: {
    repo: string;
    command: string;
    args?: string[];
    timeoutMs?: number;
    env?: Record<string, string>;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.execRepoCommand({
      repo: input.repo,
      command: input.command,
      args: input.args,
      timeoutMs: input.timeoutMs,
      env: input.env,
    });
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_REPO_EXEC_ERROR",
            message: result.stderr || `Repo command failed (exit=${result.exitCode})`,
            retryable: true,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_REPO_EXEC_ERROR",
      error?.message || "Repo execution failed",
      startedAtMs,
      true,
    );
  }
}

async function executeRepoSearchTool(
  input: {
    repo?: string;
    pattern: string;
    glob?: string;
    maxResults?: number;
    timeoutMs?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.searchRepoCode({
      repo: input.repo,
      pattern: input.pattern,
      glob: input.glob,
      maxResults: input.maxResults,
      timeoutMs: input.timeoutMs,
    });
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_REPO_SEARCH_ERROR",
            message: result.stderr || "Repo code search failed",
            retryable: true,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_REPO_SEARCH_ERROR",
      error?.message || "Repo code search failed",
      startedAtMs,
      true,
    );
  }
}

async function executeRepoReadTool(
  input: {
    repo: string;
    filePath: string;
    maxBytes?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.readRepoFile({
      repo: input.repo,
      filePath: input.filePath,
      maxBytes: input.maxBytes,
    });
    return {
      success: true,
      output: result,
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_REPO_READ_ERROR",
      error?.message || "Repo file read failed",
      startedAtMs,
      true,
    );
  }
}

async function executeRepoProbeTool(
  input: {
    repo?: string;
    timeoutMs?: number;
    maxRepos?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    if (input.repo) {
      const result = await agentEcosystemService.probeRepoAdapter({
        repo: input.repo,
        timeoutMs: input.timeoutMs,
      });
      return {
        success: result.ok,
        output: result,
        error: result.ok
          ? undefined
          : {
              code: "AGENT_ECOSYSTEM_REPO_PROBE_ERROR",
              message: result.stderr || "Repo probe failed",
              retryable: true,
            },
        metrics: { durationMs: Date.now() - startedAtMs },
      };
    }

    const result = await agentEcosystemService.probeAllRepoAdapters({
      timeoutMs: input.timeoutMs,
      maxRepos: input.maxRepos,
    });
    return {
      success: result.ok,
      output: result,
      error: result.ok
        ? undefined
        : {
            code: "AGENT_ECOSYSTEM_REPO_PROBE_ERROR",
            message: `Repo probe failures: ${result.failCount}/${result.total}`,
            retryable: true,
          },
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_REPO_PROBE_ERROR",
      error?.message || "Repo probe failed",
      startedAtMs,
      true,
    );
  }
}

async function executeDeepAuditTool(
  input: {
    timeoutMs?: number;
    maxRepos?: number;
    includeAdapters?: boolean;
    includeRuntime?: boolean;
    includeSmoke?: boolean;
    concurrency?: number;
  },
  _context: ToolContext,
): Promise<ToolResult> {
  const startedAtMs = Date.now();
  try {
    const result = await agentEcosystemService.deepAuditFusion({
      timeoutMs: input.timeoutMs,
      maxRepos: input.maxRepos,
      includeAdapters: input.includeAdapters,
      includeRuntime: input.includeRuntime,
      includeSmoke: input.includeSmoke,
      concurrency: input.concurrency,
    });
    return {
      success: true,
      output: result,
      metrics: { durationMs: Date.now() - startedAtMs },
    };
  } catch (error: any) {
    return toolFailure(
      "AGENT_ECOSYSTEM_DEEP_AUDIT_ERROR",
      error?.message || "Deep audit failed",
      startedAtMs,
      true,
    );
  }
}

export const agentEcosystemTools: ToolDefinition[] = [
  {
    name: "agent_ecosystem_status",
    description: "Get unified fusion status for external agent ecosystem repos and runtime services.",
    inputSchema: ecosystemStatusSchema,
    capabilities: ["reads_files"],
    safetyPolicy: "safe",
    execute: executeStatusTool,
  },
  {
    name: "agent_ecosystem_deep_audit",
    description:
      "Run deep operational fusion audit across cloned repos (adapter probes + runtime reachability + structural smoke checks) and return prioritized gaps.",
    inputSchema: ecosystemDeepAuditSchema,
    capabilities: ["reads_files", "executes_code"],
    safetyPolicy: "requires_confirmation",
    execute: executeDeepAuditTool,
  },
  {
    name: "agent_ecosystem_service_request",
    description:
      "Optional local HTTP proxy for ecosystem services; disabled by default in local-only fusion mode.",
    inputSchema: ecosystemProxySchema,
    capabilities: ["requires_network"],
    safetyPolicy: "requires_confirmation",
    execute: executeProxyTool,
  },
  {
    name: "agent_ecosystem_compose_control",
    description:
      "Control docker compose stack for agent ecosystem (up/down/ps/logs/restart) with guarded inputs.",
    inputSchema: ecosystemComposeSchema,
    capabilities: ["executes_code", "requires_network"],
    safetyPolicy: "dangerous",
    execute: executeComposeTool,
  },
  {
    name: "agent_ecosystem_sync_repos",
    description: "Run local sync for cloned ecosystem repositories and refresh local metadata.",
    inputSchema: ecosystemScriptSchema,
    capabilities: ["executes_code", "reads_files"],
    safetyPolicy: "requires_confirmation",
    execute: executeSyncTool,
  },
  {
    name: "agent_ecosystem_repo_exec",
    description:
      "Execute guarded commands inside a specific cloned ecosystem repo to validate/build/integrate it.",
    inputSchema: ecosystemRepoExecSchema,
    capabilities: ["executes_code", "reads_files", "writes_files"],
    safetyPolicy: "dangerous",
    execute: executeRepoExecTool,
  },
  {
    name: "agent_ecosystem_repo_search",
    description:
      "Search source code in one repo or the full ecosystem clone using ripgrep/grep through a unified API.",
    inputSchema: ecosystemRepoSearchSchema,
    capabilities: ["reads_files"],
    safetyPolicy: "safe",
    execute: executeRepoSearchTool,
  },
  {
    name: "agent_ecosystem_repo_read",
    description: "Read a file from a cloned ecosystem repository with traversal safeguards.",
    inputSchema: ecosystemRepoReadSchema,
    capabilities: ["reads_files"],
    safetyPolicy: "safe",
    execute: executeRepoReadTool,
  },
  {
    name: "agent_ecosystem_repo_probe",
    description:
      "Probe one or all cloned repos through control-plane runtime adapters to verify operational readiness.",
    inputSchema: ecosystemRepoProbeSchema,
    capabilities: ["reads_files", "executes_code"],
    safetyPolicy: "requires_confirmation",
    execute: executeRepoProbeTool,
  },
];

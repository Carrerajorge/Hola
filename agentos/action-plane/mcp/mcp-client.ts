/**
 * AgentOS Action-Plane — MCP Client
 *
 * Model Context Protocol client supporting:
 *  - Server lifecycle management (start, stop, health checks)
 *  - Tool discovery and schema inspection
 *  - Tool execution with timeout and retry
 *  - Multi-server catalog
 */

import {
  ActionResult,
  AuditEntry,
  MCPServerConfig,
  MCPTool,
} from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[MCP][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[MCP][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[MCP][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

export interface MCPTransport {
  connect(config: MCPServerConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(method: string, params: Record<string, unknown>): Promise<unknown>;
  isConnected(): boolean;
}

// ---------------------------------------------------------------------------
// Server handle (internal)
// ---------------------------------------------------------------------------

interface ServerHandle {
  config: MCPServerConfig;
  transport: MCPTransport;
  tools: Map<string, MCPTool>;
  healthy: boolean;
  lastHealthCheck: number;
}

// ---------------------------------------------------------------------------
// MCP Client Config
// ---------------------------------------------------------------------------

export interface MCPClientConfig {
  /** Factory that creates a transport for a given server config. */
  transportFactory: (config: MCPServerConfig) => MCPTransport;
  /** Health-check interval in milliseconds. */
  healthCheckIntervalMs: number;
  /** Default tool execution timeout in milliseconds. */
  defaultTimeoutMs: number;
  /** Maximum retries for transient failures. */
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// MCP Client
// ---------------------------------------------------------------------------

export class MCPClient {
  private servers = new Map<string, ServerHandle>();
  private cfg: MCPClientConfig;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: MCPClientConfig) {
    this.cfg = config;
    log.info("MCPClient initialised", {
      healthInterval: config.healthCheckIntervalMs,
      timeout: config.defaultTimeoutMs,
    });
  }

  // ---- Server lifecycle --------------------------------------------------

  async addServer(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      log.warn("Server already registered, reconnecting", { id: config.id });
      await this.removeServer(config.id);
    }

    const transport = this.cfg.transportFactory(config);
    try {
      await transport.connect(config);
    } catch (err) {
      log.error("Failed to connect to MCP server", { id: config.id, error: String(err) });
      throw err;
    }

    const handle: ServerHandle = {
      config,
      transport,
      tools: new Map(),
      healthy: true,
      lastHealthCheck: Date.now(),
    };

    this.servers.set(config.id, handle);

    // Discover tools
    await this.discoverTools(handle);

    log.info("Server added", { id: config.id, tools: handle.tools.size });
    this.ensureHealthLoop();
  }

  async removeServer(serverId: string): Promise<void> {
    const handle = this.servers.get(serverId);
    if (!handle) return;
    try {
      await handle.transport.disconnect();
    } catch (err) {
      log.warn("Error disconnecting server", { id: serverId, error: String(err) });
    }
    this.servers.delete(serverId);
    log.info("Server removed", { id: serverId });
  }

  // ---- Tool discovery ----------------------------------------------------

  listTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const handle of this.servers.values()) {
      for (const tool of handle.tools.values()) {
        tools.push(tool);
      }
    }
    return tools;
  }

  getTool(name: string): MCPTool | undefined {
    for (const handle of this.servers.values()) {
      const tool = handle.tools.get(name);
      if (tool) return tool;
    }
    return undefined;
  }

  findToolsByCapability(keyword: string): MCPTool[] {
    const lower = keyword.toLowerCase();
    return this.listTools().filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower),
    );
  }

  // ---- Tool execution ----------------------------------------------------

  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<ActionResult> {
    const start = Date.now();
    const audit: AuditEntry[] = [];
    const timeout = timeoutMs ?? this.cfg.defaultTimeoutMs;

    // Find the tool and its server
    let handle: ServerHandle | undefined;
    let tool: MCPTool | undefined;

    for (const h of this.servers.values()) {
      const t = h.tools.get(toolName);
      if (t) {
        handle = h;
        tool = t;
        break;
      }
    }

    if (!handle || !tool) {
      return this.fail(`mcp-${toolName}`, `Tool not found: ${toolName}`, start, audit);
    }

    if (!tool.available || !handle.healthy) {
      return this.fail(`mcp-${toolName}`, `Tool or server unavailable: ${toolName}`, start, audit);
    }

    audit.push(this.auditInfo(`Invoking tool ${toolName} on server ${handle.config.id}`));

    // Retry loop
    let lastError = "";
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        const result = await this.callWithTimeout(
          handle.transport,
          "tools/call",
          { name: toolName, arguments: params },
          timeout,
        );

        audit.push(this.auditInfo(`Tool returned on attempt ${attempt + 1}`));
        return {
          actionId: `mcp-${toolName}-${Date.now()}`,
          status: "success",
          data: result,
          durationMs: Date.now() - start,
          auditLog: audit,
          timestamp: new Date(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn("Tool execution attempt failed", { toolName, attempt, error: lastError });
        audit.push({ timestamp: new Date(), level: "warn", message: `Attempt ${attempt + 1} failed: ${lastError}` });

        if (attempt < this.cfg.maxRetries) {
          // Exponential back-off (50ms, 100ms, 200ms ...)
          await this.sleep(50 * Math.pow(2, attempt));
        }
      }
    }

    return this.fail(`mcp-${toolName}`, `All retries exhausted: ${lastError}`, start, audit);
  }

  // ---- Health checks -----------------------------------------------------

  private ensureHealthLoop(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      void this.runHealthChecks();
    }, this.cfg.healthCheckIntervalMs);
  }

  private async runHealthChecks(): Promise<void> {
    for (const [id, handle] of this.servers) {
      try {
        if (!handle.transport.isConnected()) {
          handle.healthy = false;
          log.warn("Server disconnected", { id });
          continue;
        }
        await handle.transport.send("ping", {});
        handle.healthy = true;
        handle.lastHealthCheck = Date.now();
      } catch {
        handle.healthy = false;
        log.warn("Health check failed", { id });
      }
    }
  }

  // ---- Internal helpers --------------------------------------------------

  private async discoverTools(handle: ServerHandle): Promise<void> {
    try {
      const response = await handle.transport.send("tools/list", {}) as { tools?: Array<Record<string, unknown>> };
      const rawTools = response?.tools ?? [];

      for (const raw of rawTools) {
        const tool: MCPTool = {
          name: String(raw["name"] ?? ""),
          description: String(raw["description"] ?? ""),
          inputSchema: (raw["inputSchema"] as Record<string, unknown>) ?? {},
          outputSchema: raw["outputSchema"] as Record<string, unknown> | undefined,
          serverId: handle.config.id,
          version: raw["version"] as string | undefined,
          available: true,
        };
        handle.tools.set(tool.name, tool);
      }
    } catch (err) {
      log.error("Tool discovery failed", { id: handle.config.id, error: String(err) });
    }
  }

  private async callWithTimeout(
    transport: MCPTransport,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return Promise.race([
      transport.send(method, params),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  private fail(actionId: string, error: string, start: number, audit: AuditEntry[]): ActionResult {
    audit.push({ timestamp: new Date(), level: "error", message: error });
    return {
      actionId,
      status: "failure",
      error,
      durationMs: Date.now() - start,
      auditLog: audit,
      timestamp: new Date(),
    };
  }

  private auditInfo(message: string): AuditEntry {
    return { timestamp: new Date(), level: "info", message };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- Cleanup -----------------------------------------------------------

  async shutdown(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    for (const id of [...this.servers.keys()]) {
      await this.removeServer(id);
    }
    log.info("MCPClient shut down");
  }
}

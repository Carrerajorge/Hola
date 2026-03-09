/**
 * @file mcpManager.ts
 * @description MCP (Model Context Protocol) Server Manager for the ILIAGPT × OpenClaw fusion bridge.
 *
 * Manages the full lifecycle of MCP tool servers, supporting three transport modes:
 *   - `stdio`:            spawns a local child process and communicates over stdin/stdout
 *   - `sse`:              connects to a remote Server-Sent Events endpoint
 *   - `streamable-http`:  connects to a remote HTTP streaming endpoint
 *
 * @module mcpManager
 */

import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types & interfaces
// ---------------------------------------------------------------------------

/**
 * Configuration for a single MCP tool server.
 */
export interface MCPServerConfig {
  /** Unique human-readable identifier for this server. */
  name: string;
  /** Transport protocol used to communicate with the server. */
  transport: 'stdio' | 'sse' | 'streamable-http';
  /**
   * Executable to launch (stdio transport only).
   * @example 'node', 'python', '/usr/local/bin/mcp-server'
   */
  command?: string;
  /** Arguments passed to `command` (stdio transport only). */
  args?: string[];
  /** Remote base URL (sse / streamable-http transport). */
  url?: string;
  /** Additional environment variables injected into the child process (stdio only). */
  env?: Record<string, string>;
  /** Capability identifiers advertised by this server (e.g. 'tools', 'resources'). */
  capabilities: string[];
  /** Whether the manager should start this server automatically on construction. */
  autoStart: boolean;
}

/**
 * Runtime status snapshot for a single MCP server.
 */
export interface MCPServerStatus {
  name: string;
  transport: MCPServerConfig['transport'];
  connected: boolean;
  capabilities: string[];
  /** Seconds since the server was successfully started; -1 if not running. */
  uptime: number;
}

/** Internal bookkeeping record tracked per server. */
interface ServerRecord {
  config: MCPServerConfig;
  childProcess?: ChildProcess;
  connected: boolean;
  startedAt?: Date;
  /** Pending JSON-RPC request resolvers keyed by request id. */
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  nextRequestId: number;
}

// ---------------------------------------------------------------------------
// MCPManager
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of one or more MCP tool servers.
 *
 * @example
 * ```typescript
 * const manager = new MCPManager([
 *   { name: 'fs-tools', transport: 'stdio', command: 'node', args: ['./mcp-fs.js'],
 *     capabilities: ['tools'], autoStart: true },
 * ]);
 * await manager.startAutoStartServers();
 * const result = await manager.callTool('fs-tools', 'readFile', { path: '/etc/hosts' });
 * await manager.shutdownAll();
 * ```
 */
export class MCPManager extends EventEmitter {
  private readonly logger: Logger;
  private readonly servers: Map<string, ServerRecord> = new Map();

  constructor(configs: MCPServerConfig[]) {
    super();
    this.logger = new Logger('MCPManager');

    for (const config of configs) {
      this.servers.set(config.name, {
        config,
        connected: false,
        pendingRequests: new Map(),
        nextRequestId: 1,
      });
    }

    this.logger.info(`Registered ${configs.length} MCP server(s): ${configs.map((c) => c.name).join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start all servers that have `autoStart: true`.
   * Resolves once every auto-start server has either connected or failed (without throwing).
   */
  async startAutoStartServers(): Promise<void> {
    const autoStartServers = [...this.servers.values()].filter((r) => r.config.autoStart);

    if (autoStartServers.length === 0) {
      this.logger.info('No auto-start MCP servers configured.');
      return;
    }

    this.logger.info(`Starting ${autoStartServers.length} auto-start server(s)…`);

    await Promise.allSettled(
      autoStartServers.map(async (record) => {
        try {
          await this._startServer(record);
        } catch (err) {
          this.logger.error(`Failed to start server "${record.config.name}": ${(err as Error).message}`);
        }
      }),
    );

    this.logger.info(`Auto-start complete. ${this.getActiveCount()} server(s) connected.`);
  }

  /**
   * Return the number of currently connected MCP servers.
   */
  getActiveCount(): number {
    return [...this.servers.values()].filter((r) => r.connected).length;
  }

  /**
   * Return a status snapshot for every registered server.
   */
  getServerStatuses(): MCPServerStatus[] {
    return [...this.servers.values()].map((record) => ({
      name: record.config.name,
      transport: record.config.transport,
      connected: record.connected,
      capabilities: record.config.capabilities,
      uptime: record.connected && record.startedAt
        ? Math.floor((Date.now() - record.startedAt.getTime()) / 1000)
        : -1,
    }));
  }

  /**
   * Execute a named tool on a specific MCP server using JSON-RPC 2.0.
   *
   * @param serverName - The `name` field from MCPServerConfig.
   * @param toolName   - The tool to invoke (e.g. `'readFile'`).
   * @param args       - Arbitrary key/value arguments forwarded to the tool.
   * @returns The `result` portion of the JSON-RPC response.
   * @throws If the server is unknown, disconnected, or returns an error.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const record = this._requireConnected(serverName);

    this.logger.debug(`callTool: server="${serverName}" tool="${toolName}" args=${JSON.stringify(args)}`);

    const id = record.nextRequestId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    return new Promise<unknown>((resolve, reject) => {
      record.pendingRequests.set(id, { resolve, reject });

      if (record.config.transport === 'stdio') {
        const proc = record.childProcess!;
        if (!proc.stdin?.writable) {
          record.pendingRequests.delete(id);
          return reject(new Error(`stdin of server "${serverName}" is not writable`));
        }
        proc.stdin.write(payload + '\n');
      } else {
        // sse / streamable-http: delegate to HTTP helper
        this._sendHttpRequest(record, id, payload).catch((err) => {
          record.pendingRequests.delete(id);
          reject(err);
        });
      }
    });
  }

  /**
   * Kill all spawned child processes and mark every server as disconnected.
   */
  async shutdownAll(): Promise<void> {
    this.logger.info('Shutting down all MCP servers…');

    for (const record of this.servers.values()) {
      await this._stopServer(record);
    }

    this.logger.info('All MCP servers shut down.');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Start a single server based on its transport type. */
  private async _startServer(record: ServerRecord): Promise<void> {
    const { config } = record;

    if (config.transport === 'stdio') {
      await this._startStdioServer(record);
    } else {
      await this._verifyRemoteServer(record);
    }
  }

  /** Spawn a stdio child process and wire up JSON-RPC framing. */
  private _startStdioServer(record: ServerRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const { config } = record;

      if (!config.command) {
        return reject(new Error(`Server "${config.name}" is stdio transport but has no command.`));
      }

      this.logger.debug(`Spawning: ${config.command} ${(config.args ?? []).join(' ')}`);

      const proc = spawn(config.command, config.args ?? [], {
        env: { ...process.env, ...(config.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      record.childProcess = proc;

      let initDone = false;
      let buffer = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this._handleStdioLine(record, trimmed, () => {
            if (!initDone) {
              initDone = true;
              record.connected = true;
              record.startedAt = new Date();
              this.logger.info(`MCP server "${config.name}" (stdio) connected.`);
              resolve();
            }
          });
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        this.logger.warn(`[${config.name}] stderr: ${chunk.toString().trim()}`);
      });

      proc.on('error', (err) => {
        this.logger.error(`[${config.name}] process error: ${err.message}`);
        record.connected = false;
        this._rejectAllPending(record, err);
        if (!initDone) {
          initDone = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        this.logger.warn(`[${config.name}] process exited with code ${code}.`);
        record.connected = false;
        this._rejectAllPending(record, new Error(`MCP server "${config.name}" exited (code ${code})`));
        this.emit('server:exit', config.name, code);
      });

      // Send MCP initialize handshake
      proc.stdin?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'iliagpt-fusion', version: '1.0.0' } },
        }) + '\n',
      );

      // Timeout guard for the initialization handshake
      setTimeout(() => {
        if (!initDone) {
          initDone = true;
          record.connected = true; // Optimistically mark connected after timeout
          record.startedAt = new Date();
          this.logger.warn(`[${config.name}] init handshake timed out – assuming connected.`);
          resolve();
        }
      }, 5000);
    });
  }

  /** Parse an incoming JSON-RPC line from a stdio server and dispatch it. */
  private _handleStdioLine(record: ServerRecord, line: string, onFirstMessage: () => void): void {
    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.warn(`[${record.config.name}] Non-JSON stdout: ${line}`);
      return;
    }

    onFirstMessage();

    if (msg.id !== undefined) {
      const pending = record.pendingRequests.get(msg.id);
      if (pending) {
        record.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    }

    if (msg.method) {
      // Server-initiated notification – emit for external listeners
      this.emit('notification', record.config.name, msg);
    }
  }

  /** Verify connectivity to a remote SSE / streamable-http server. */
  private async _verifyRemoteServer(record: ServerRecord): Promise<void> {
    const { config } = record;

    if (!config.url) {
      throw new Error(`Server "${config.name}" requires a url for ${config.transport} transport.`);
    }

    try {
      const response = await fetch(config.url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      record.connected = response.ok || response.status < 500;
      record.startedAt = new Date();
      this.logger.info(`MCP server "${config.name}" (${config.transport}) reachable at ${config.url}.`);
    } catch (err) {
      throw new Error(`Cannot reach MCP server "${config.name}" at ${config.url}: ${(err as Error).message}`);
    }
  }

  /** Stop a server and clean up its resources. */
  private async _stopServer(record: ServerRecord): Promise<void> {
    if (record.childProcess) {
      record.childProcess.kill('SIGTERM');
      record.childProcess = undefined;
    }
    record.connected = false;
    this._rejectAllPending(record, new Error(`Server "${record.config.name}" was shut down`));
    this.logger.debug(`Server "${record.config.name}" stopped.`);
  }

  /** Reject all pending JSON-RPC requests for a server. */
  private _rejectAllPending(record: ServerRecord, error: Error): void {
    for (const { reject } of record.pendingRequests.values()) {
      reject(error);
    }
    record.pendingRequests.clear();
  }

  /** Throw if the server is not registered or not connected. */
  private _requireConnected(serverName: string): ServerRecord {
    const record = this.servers.get(serverName);
    if (!record) throw new Error(`Unknown MCP server: "${serverName}"`);
    if (!record.connected) throw new Error(`MCP server "${serverName}" is not connected`);
    return record;
  }

  /** Send a JSON-RPC request to a remote (SSE/HTTP) MCP server. */
  private async _sendHttpRequest(record: ServerRecord, id: number, payload: string): Promise<void> {
    const { config } = record;
    const url = config.transport === 'sse'
      ? `${config.url}/message`
      : `${config.url}/rpc`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from MCP server "${config.name}"`);
    }

    const data = await response.json() as { id?: number; result?: unknown; error?: { message: string } };
    const pending = record.pendingRequests.get(id);
    if (pending) {
      record.pendingRequests.delete(id);
      if (data.error) {
        pending.reject(new Error(data.error.message));
      } else {
        pending.resolve(data.result);
      }
    }
  }
}

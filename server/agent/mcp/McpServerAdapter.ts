import { ToolDefinition, ExecutionContext, ToolResult } from "../pipeline/types";
import { spawn, ChildProcess } from "child_process";
import { randomUUID } from "crypto";

/**
 * Model Context Protocol (MCP) Adapter
 * 
 * Este adaptador permite conectar herramientas locales (stdio) 
 * bajo el protocolo MCP con el orquestador ReAct interno.
 * Transforma las llamadas de función internas en mensajes JSON-RPC 2.0
 */

export class McpServerAdapter {
  private process: ChildProcess;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void }> = new Map();
  
  constructor(private command: string, private args: string[]) {
    this.process = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.process.stdout?.on('data', (data) => {
      const messages = data.toString().split('\n').filter(Boolean);
      for (const msg of messages) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.id && this.pendingRequests.has(parsed.id)) {
            const { resolve, reject } = this.pendingRequests.get(parsed.id)!;
            if (parsed.error) reject(parsed.error);
            else resolve(parsed.result);
            this.pendingRequests.delete(parsed.id);
          }
        } catch (e) {
          console.warn("[MCP] Unparseable message from stdio server:", msg);
        }
      }
    });
  }

  async callTool(name: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pendingRequests.set(id, { resolve, reject });
      
      const payload = {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: params }
      };

      this.process.stdin?.write(JSON.stringify(payload) + "\n");
    });
  }

  createToolDefinition(name: string, description: string, inputSchema: any, capabilities: string[] = []): ToolDefinition {
    return {
      id: `mcp_${name}`,
      name,
      description,
      category: "advanced",
      capabilities: ["mcp", ...capabilities],
      inputSchema,
      execute: async (context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> => {
        try {
          const result = await this.callTool(name, params);
          return { success: true, data: result };
        } catch (error: any) {
          return { success: false, error: error.message || "MCP Tool Execution Failed" };
        }
      }
    };
  }

  shutdown() {
    this.process.kill();
  }
}

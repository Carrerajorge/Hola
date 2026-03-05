import { ToolDefinition, ExecutionContext, ToolResult } from "../pipeline/types";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const processMonitorTool: ToolDefinition = {
  id: "process_monitor",
  name: "Process Monitor",
  description: "List, search, and kill running OS processes.",
  category: "advanced",
  capabilities: ["process", "system", "kill", "ps"],
  inputSchema: {
    action: { type: "string", enum: ["list", "search", "kill"], required: true },
    query: { type: "string", description: "Process name or PID to search/kill" },
    force: { type: "boolean", description: "Force kill (SIGKILL)" }
  },
  execute: async (context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> => {
    const { action, query, force } = params;

    try {
      if (action === "list" || action === "search") {
        const { stdout } = await execAsync(`ps aux | grep "${query || ''}" | grep -v grep | head -n 20`);
        return { success: true, data: { processes: stdout } };
      }
      
      if (action === "kill") {
        if (!context.escalationGranted) {
          return { success: false, error: "PERMISSION_DENIED: Killing processes requires user confirmation." };
        }
        const signal = force ? "-9" : "-15";
        await execAsync(`kill ${signal} $(pgrep -f "${query}")`);
        return { success: true, data: `Process ${query} terminated.` };
      }
      
      return { success: false, error: "Invalid action" };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
};

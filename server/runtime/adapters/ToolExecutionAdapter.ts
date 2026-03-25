import type { ToolRuntime } from "../contracts";
import type { RuntimeHealth, UnifiedToolDefinition, UnifiedToolOptions, UnifiedToolResult } from "../types";

export class ToolExecutionAdapter implements ToolRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "tool-execution",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async listTools(_query?: { category?: string; refresh?: boolean }): Promise<UnifiedToolDefinition[]> {
    throw new Error("TODO: wire toolExecutionEngine.listTools");
  }

  async getTool(_name: string): Promise<UnifiedToolDefinition | null> {
    throw new Error("TODO: wire toolExecutionEngine.getTool");
  }

  async execute(_name: string, _input: Record<string, unknown>, _options?: UnifiedToolOptions): Promise<UnifiedToolResult> {
    throw new Error("TODO: wire toolExecutionEngine.execute");
  }
}

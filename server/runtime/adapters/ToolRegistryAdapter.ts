import type { ToolRuntime } from "../contracts";
import type { RuntimeHealth, UnifiedToolDefinition, UnifiedToolOptions, UnifiedToolResult } from "../types";

export class ToolRegistryAdapter implements ToolRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "tool-execution",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { adapter: "tool-registry" },
    };
  }

  async listTools(_query?: { category?: string; refresh?: boolean }): Promise<UnifiedToolDefinition[]> {
    throw new Error("TODO: wire ToolRegistryService");
  }

  async getTool(_name: string): Promise<UnifiedToolDefinition | null> {
    throw new Error("TODO: wire ToolRegistryService lookup");
  }

  async execute(_name: string, _input: Record<string, unknown>, _options?: UnifiedToolOptions): Promise<UnifiedToolResult> {
    throw new Error("ToolRegistryAdapter does not execute tools directly");
  }
}

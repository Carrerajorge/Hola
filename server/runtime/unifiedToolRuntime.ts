import type { ToolRuntime } from "./contracts";
import type { RuntimeHealth, UnifiedToolDefinition, UnifiedToolOptions, UnifiedToolResult } from "./types";
import { ToolExecutionAdapter } from "./adapters/ToolExecutionAdapter";
import { ToolRegistryAdapter } from "./adapters/ToolRegistryAdapter";

export class UnifiedToolRuntime implements ToolRuntime {
  constructor(
    private readonly execution = new ToolExecutionAdapter(),
    private readonly registry = new ToolRegistryAdapter(),
  ) {}

  async health(): Promise<RuntimeHealth> {
    return {
      engine: "tool-execution",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { facade: "UnifiedToolRuntime" },
    };
  }

  async listTools(query?: { category?: string; refresh?: boolean }): Promise<UnifiedToolDefinition[]> {
    return this.execution.listTools(query);
  }

  async getTool(name: string): Promise<UnifiedToolDefinition | null> {
    return this.execution.getTool(name);
  }

  async execute(name: string, input: Record<string, unknown>, options?: UnifiedToolOptions): Promise<UnifiedToolResult> {
    return this.execution.execute(name, input, options);
  }
}

import type { MemoryRuntime } from "./contracts";
import type { RuntimeHealth, UnifiedMemoryRecord } from "./types";
import { MemoryServiceAdapter } from "./adapters/MemoryServiceAdapter";

export class UnifiedMemoryRuntime implements MemoryRuntime {
  constructor(private readonly memoryAdapter = new MemoryServiceAdapter()) {}

  async health(): Promise<RuntimeHealth> {
    return {
      engine: "memory-service",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { facade: "UnifiedMemoryRuntime" },
    };
  }

  async store(userId: string, type: string, content: string, options?: Record<string, unknown>): Promise<string> {
    return this.memoryAdapter.store(userId, type, content, options);
  }

  async recall(userId: string, options?: Record<string, unknown>): Promise<UnifiedMemoryRecord[]> {
    return this.memoryAdapter.recall(userId, options);
  }

  async getContext(userId: string): Promise<string> {
    return this.memoryAdapter.getContext(userId);
  }
}

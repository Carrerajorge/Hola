import type { MemoryRuntime } from "../contracts";
import type { RuntimeHealth, UnifiedMemoryRecord } from "../types";

export class MemoryServiceAdapter implements MemoryRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "memory-service",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async store(_userId: string, _type: string, _content: string, _options?: Record<string, unknown>): Promise<string> {
    throw new Error("TODO: wire memoryService.store");
  }

  async recall(_userId: string, _options?: Record<string, unknown>): Promise<UnifiedMemoryRecord[]> {
    throw new Error("TODO: wire memoryService.retrieve");
  }

  async getContext(_userId: string): Promise<string> {
    throw new Error("TODO: wire memoryService.getContextMemories");
  }
}

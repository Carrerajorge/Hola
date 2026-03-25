import type { AgentRuntime, ToolRuntime, MemoryRuntime, ScheduleRuntime } from "../contracts";

export interface RuntimeRegistry {
  agentRuntime: AgentRuntime;
  toolRuntime: ToolRuntime;
  memoryRuntime: MemoryRuntime;
  scheduleRuntime: ScheduleRuntime;
}

let runtimeRegistry: RuntimeRegistry | null = null;

export function setRuntimeRegistry(registry: RuntimeRegistry): void {
  runtimeRegistry = registry;
}

export function getRuntimeRegistry(): RuntimeRegistry {
  if (!runtimeRegistry) {
    throw new Error("Runtime registry not initialized");
  }
  return runtimeRegistry;
}

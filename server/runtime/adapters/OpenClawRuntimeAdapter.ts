import type { AgentRuntime } from "../contracts";
import type {
  RuntimeHealth,
  UnifiedExecutionRequest,
  UnifiedExecutionResult,
  UnifiedPlanRequest,
  UnifiedPlanResult,
  UnifiedSubagentQuery,
  UnifiedSubagentRequest,
  UnifiedSubagentRun,
} from "../types";

export class OpenClawRuntimeAdapter implements AgentRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "openclaw-native",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async execute(_request: UnifiedExecutionRequest): Promise<UnifiedExecutionResult> {
    throw new Error("TODO: wire executeOpenClawNativePrompt");
  }

  async plan(_request: UnifiedPlanRequest): Promise<UnifiedPlanResult> {
    throw new Error("TODO: wire orchestrationEngine");
  }

  async spawnSubagent(_request: UnifiedSubagentRequest): Promise<UnifiedSubagentRun> {
    throw new Error("TODO: wire openclawSubagentService.spawn");
  }

  async listSubagents(_query?: UnifiedSubagentQuery): Promise<UnifiedSubagentRun[]> {
    throw new Error("TODO: wire openclawSubagentService.list");
  }

  async cancelSubagent(_runId: string, _userId?: string): Promise<boolean> {
    throw new Error("TODO: wire openclawSubagentService.cancel");
  }
}

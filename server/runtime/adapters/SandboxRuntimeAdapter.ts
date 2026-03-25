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

export class SandboxRuntimeAdapter implements AgentRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "sandbox-agent",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async execute(_request: UnifiedExecutionRequest): Promise<UnifiedExecutionResult> {
    throw new Error("TODO: wire AgentV2 / sandbox runtime");
  }

  async plan(_request: UnifiedPlanRequest): Promise<UnifiedPlanResult> {
    throw new Error("TODO: wire taskPlanner");
  }

  async spawnSubagent(_request: UnifiedSubagentRequest): Promise<UnifiedSubagentRun> {
    throw new Error("Sandbox runtime does not support subagents yet");
  }

  async listSubagents(_query?: UnifiedSubagentQuery): Promise<UnifiedSubagentRun[]> {
    return [];
  }

  async cancelSubagent(_runId: string, _userId?: string): Promise<boolean> {
    return false;
  }
}

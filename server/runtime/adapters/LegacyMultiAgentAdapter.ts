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

export class LegacyMultiAgentAdapter implements AgentRuntime {
  async health(): Promise<RuntimeHealth> {
    return {
      engine: "legacy-multi-agent",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  async execute(_request: UnifiedExecutionRequest): Promise<UnifiedExecutionResult> {
    throw new Error("TODO: wire legacy agentManager execution path");
  }

  async plan(_request: UnifiedPlanRequest): Promise<UnifiedPlanResult> {
    throw new Error("Legacy multi-agent planner not wired");
  }

  async spawnSubagent(_request: UnifiedSubagentRequest): Promise<UnifiedSubagentRun> {
    throw new Error("Legacy multi-agent runtime does not support subagents");
  }

  async listSubagents(_query?: UnifiedSubagentQuery): Promise<UnifiedSubagentRun[]> {
    return [];
  }

  async cancelSubagent(_runId: string, _userId?: string): Promise<boolean> {
    return false;
  }
}

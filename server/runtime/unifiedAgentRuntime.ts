import type { AgentRuntime } from "./contracts";
import type {
  RuntimeHealth,
  UnifiedExecutionRequest,
  UnifiedExecutionResult,
  UnifiedPlanRequest,
  UnifiedPlanResult,
  UnifiedSubagentQuery,
  UnifiedSubagentRequest,
  UnifiedSubagentRun,
} from "./types";
import { chooseAgentRuntime } from "./policies/executionRoutingPolicy";
import { OpenClawRuntimeAdapter } from "./adapters/OpenClawRuntimeAdapter";
import { SandboxRuntimeAdapter } from "./adapters/SandboxRuntimeAdapter";
import { LegacyMultiAgentAdapter } from "./adapters/LegacyMultiAgentAdapter";

export class UnifiedAgentRuntime implements AgentRuntime {
  constructor(
    private readonly openclaw = new OpenClawRuntimeAdapter(),
    private readonly sandbox = new SandboxRuntimeAdapter(),
    private readonly legacy = new LegacyMultiAgentAdapter(),
  ) {}

  async health(): Promise<RuntimeHealth> {
    return {
      engine: "openclaw-native",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      details: { facade: "UnifiedAgentRuntime" },
    };
  }

  private resolveRuntime(request: UnifiedExecutionRequest): AgentRuntime {
    const selected = chooseAgentRuntime(request);
    if (selected === "sandbox") return this.sandbox;
    if (selected === "legacy") return this.legacy;
    return this.openclaw;
  }

  async execute(request: UnifiedExecutionRequest): Promise<UnifiedExecutionResult> {
    return this.resolveRuntime(request).execute(request);
  }

  async plan(request: UnifiedPlanRequest): Promise<UnifiedPlanResult> {
    return this.openclaw.plan(request);
  }

  async spawnSubagent(request: UnifiedSubagentRequest): Promise<UnifiedSubagentRun> {
    return this.openclaw.spawnSubagent(request);
  }

  async listSubagents(query?: UnifiedSubagentQuery): Promise<UnifiedSubagentRun[]> {
    return this.openclaw.listSubagents(query);
  }

  async cancelSubagent(runId: string, userId?: string): Promise<boolean> {
    return this.openclaw.cancelSubagent(runId, userId);
  }
}

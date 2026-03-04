import { BasePlane } from "../base_plane";
import { PolicyEngine } from "./policy_engine";
import { TaskScheduler } from "./scheduler";
import { RateLimiter } from "./rate_limiter";

export class ControlPlane extends BasePlane {
  public policy: PolicyEngine;
  public scheduler: TaskScheduler;
  public limiter: RateLimiter;

  constructor(os: any) {
    super(os);
    this.policy = new PolicyEngine();
    this.scheduler = new TaskScheduler();
    this.limiter = new RateLimiter();
  }

  async initialize() {
    console.log("[ControlPlane] Initializing Governance Systems...");
    this.scheduler.start();
  }

  // Unified Validation Point
  async validateAction(userId: string, action: { type: string; tool?: string; risk?: string; params?: any }) {
    // 1. Rate Limiting
    const limitCheck = this.limiter.check(userId);
    if (!limitCheck.allowed) {
        return { allowed: false, reason: `Rate limit exceeded. Retry in ${Math.ceil(limitCheck.resetIn / 1000)}s` };
    }

    // 2. PII Sanitization (Modify params in place if needed, or just warn)
    // For now we just log/sanitize string params
    if (action.params && typeof action.params === 'object') {
        // Simple recursive sanitization could go here
    }

    // 3. Policy Check
    if (action.type === "tool_execution" && action.tool) {
        const result = await this.policy.evaluate({
            toolName: action.tool,
            args: action.params,
            userRole: "operator", // TODO: Fetch real role
            mode: this.os.config.mode
        });

        // Audit decision
        this.os.data.record({
            type: "governance_decision",
            actor: userId,
            payload: { tool: action.tool, allowed: result.allowed, reason: result.reason },
            timestamp: Date.now()
        });

        if (!result.allowed) {
            return { allowed: false, reason: result.reason };
        }
    }

    return { allowed: true };
  }
}

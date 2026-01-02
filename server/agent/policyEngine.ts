import { z } from "zod";
import type { ToolCapability, UserPlan } from "./contracts";

export const ToolCapabilities = {
  REQUIRES_NETWORK: "requires_network",
  PRODUCES_ARTIFACTS: "produces_artifacts", 
  READS_FILES: "reads_files",
  WRITES_FILES: "writes_files",
  EXECUTES_CODE: "executes_code",
  ACCESSES_EXTERNAL_API: "accesses_external_api",
  LONG_RUNNING: "long_running",
  HIGH_RISK: "high_risk",
} as const;

export interface ToolPolicy {
  toolName: string;
  capabilities: ToolCapability[];
  allowedPlans: UserPlan[];
  requiresConfirmation: boolean;
  maxExecutionTimeMs: number;
  maxRetries: number;
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
  deniedByDefault: boolean;
}

const DEFAULT_TOOL_POLICIES: Record<string, Partial<ToolPolicy>> = {
  analyze_spreadsheet: {
    capabilities: ["reads_files", "produces_artifacts"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 120000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  web_search: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 3,
    deniedByDefault: false,
  },
  generate_image: {
    capabilities: ["requires_network", "accesses_external_api", "produces_artifacts"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  browse_url: {
    capabilities: ["requires_network", "accesses_external_api", "long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 45000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  generate_document: {
    capabilities: ["produces_artifacts", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  execute_code: {
    capabilities: ["executes_code", "high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 30000,
    maxRetries: 1,
    deniedByDefault: true,
  },
};

export interface PolicyCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
  policy: ToolPolicy;
}

export interface PolicyContext {
  userId: string;
  userPlan: UserPlan;
  toolName: string;
  isConfirmed?: boolean;
}

export class PolicyEngine {
  private policies: Map<string, ToolPolicy> = new Map();
  private callCounts: Map<string, { count: number; windowStart: number }> = new Map();

  constructor() {
    this.initializeDefaultPolicies();
  }

  private initializeDefaultPolicies(): void {
    for (const [toolName, partialPolicy] of Object.entries(DEFAULT_TOOL_POLICIES)) {
      const policy: ToolPolicy = {
        toolName,
        capabilities: partialPolicy.capabilities || [],
        allowedPlans: partialPolicy.allowedPlans || ["admin"],
        requiresConfirmation: partialPolicy.requiresConfirmation ?? true,
        maxExecutionTimeMs: partialPolicy.maxExecutionTimeMs ?? 30000,
        maxRetries: partialPolicy.maxRetries ?? 1,
        rateLimit: partialPolicy.rateLimit,
        deniedByDefault: partialPolicy.deniedByDefault ?? true,
      };
      this.policies.set(toolName, policy);
    }
  }

  registerPolicy(policy: ToolPolicy): void {
    this.policies.set(policy.toolName, policy);
    console.log(`[PolicyEngine] Registered policy for tool: ${policy.toolName}`);
  }

  getPolicy(toolName: string): ToolPolicy | undefined {
    return this.policies.get(toolName);
  }

  checkAccess(context: PolicyContext): PolicyCheckResult {
    const policy = this.policies.get(context.toolName);

    if (!policy) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `No policy defined for tool: ${context.toolName}`,
        policy: this.createDenyAllPolicy(context.toolName),
      };
    }

    if (policy.deniedByDefault && context.userPlan !== "admin") {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Tool ${context.toolName} is denied by default`,
        policy,
      };
    }

    if (!policy.allowedPlans.includes(context.userPlan)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Tool ${context.toolName} requires plan: ${policy.allowedPlans.join(" or ")}. Current plan: ${context.userPlan}`,
        policy,
      };
    }

    if (policy.rateLimit) {
      const key = `${context.userId}:${context.toolName}`;
      const now = Date.now();
      const callData = this.callCounts.get(key);

      if (callData) {
        if (now - callData.windowStart < policy.rateLimit.windowMs) {
          if (callData.count >= policy.rateLimit.maxCalls) {
            return {
              allowed: false,
              requiresConfirmation: false,
              reason: `Rate limit exceeded for ${context.toolName}: ${policy.rateLimit.maxCalls} calls per ${policy.rateLimit.windowMs}ms`,
              policy,
            };
          }
        } else {
          this.callCounts.set(key, { count: 0, windowStart: now });
        }
      } else {
        this.callCounts.set(key, { count: 0, windowStart: now });
      }
    }

    if (policy.requiresConfirmation && !context.isConfirmed) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Tool ${context.toolName} requires user confirmation before execution`,
        policy,
      };
    }

    return {
      allowed: true,
      requiresConfirmation: false,
      policy,
    };
  }

  incrementRateLimit(context: PolicyContext): void {
    const policy = this.policies.get(context.toolName);
    if (!policy?.rateLimit) return;
    
    const key = `${context.userId}:${context.toolName}`;
    const callData = this.callCounts.get(key);
    if (callData) {
      callData.count++;
    }
  }

  getCapabilities(toolName: string): ToolCapability[] {
    const policy = this.policies.get(toolName);
    return policy?.capabilities || [];
  }

  hasCapability(toolName: string, capability: ToolCapability): boolean {
    const capabilities = this.getCapabilities(toolName);
    return capabilities.includes(capability);
  }

  getToolsWithCapability(capability: ToolCapability): string[] {
    return Array.from(this.policies.entries())
      .filter(([_, policy]) => policy.capabilities.includes(capability))
      .map(([name]) => name);
  }

  getToolsForPlan(plan: UserPlan): string[] {
    return Array.from(this.policies.entries())
      .filter(([_, policy]) => policy.allowedPlans.includes(plan) && !policy.deniedByDefault)
      .map(([name]) => name);
  }

  private createDenyAllPolicy(toolName: string): ToolPolicy {
    return {
      toolName,
      capabilities: [],
      allowedPlans: [],
      requiresConfirmation: true,
      maxExecutionTimeMs: 0,
      maxRetries: 0,
      deniedByDefault: true,
    };
  }

  clearRateLimits(): void {
    this.callCounts.clear();
  }
}

export const policyEngine = new PolicyEngine();

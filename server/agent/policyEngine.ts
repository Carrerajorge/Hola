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
  allowedWorkspaces?: string[]; // Empty implies no restriction
}

export interface PolicyDecisionAudit {
  id: string;
  timestamp: Date;
  userId: string;
  workspaceId?: string;
  toolName: string;
  allowed: boolean;
  reason?: string;
  context: PolicyContext;
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
  fetch_url: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 45000,
    maxRetries: 2,
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
  browse_and_act: {
    capabilities: ["requires_network", "accesses_external_api", "long_running", "high_risk"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 300000,
    maxRetries: 1,
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
  create_document: {
    capabilities: ["produces_artifacts", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  create_presentation: {
    capabilities: ["produces_artifacts", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  create_spreadsheet: {
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
  read_file: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 10000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  write_file: {
    capabilities: ["writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 15000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  shell_command: {
    capabilities: ["executes_code", "high_risk"],
    allowedPlans: ["admin"],
    // Confirmation is decided by the tool based on the actual command risk.
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  list_files: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 5000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  analyze_data: {
    capabilities: [],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  generate_chart: {
    capabilities: ["produces_artifacts"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  // Native agentic fusion tools
  spawn_subagent: {
    capabilities: ["long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 300000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  memory_search: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 45000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_spawn_subagent: {
    capabilities: ["long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 300000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  openclaw_subagent_status: {
    capabilities: [],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_subagent_list: {
    capabilities: [],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_subagent_cancel: {
    capabilities: ["high_risk"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  openclaw_rag_search: {
    capabilities: ["reads_files", "accesses_external_api"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_rag_context: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_clawi_status: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_clawi_exec: {
    capabilities: ["executes_code", "high_risk", "long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 300000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  openclaw_read: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_write: {
    capabilities: ["writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_list: {
    capabilities: ["reads_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  openclaw_exec: {
    capabilities: ["executes_code", "high_risk", "long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 300000,
    maxRetries: 1,
    deniedByDefault: false,
  },

  // Sandbox tool aliases (server/agent/sandbox/*)
  shell: {
    capabilities: ["executes_code", "high_risk", "long_running"],
    allowedPlans: ["admin"],
    // Confirmation is decided by the tool registry based on command risk.
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  file: {
    capabilities: ["reads_files", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 15000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  python: {
    capabilities: ["executes_code", "high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 30000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  search: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 3,
    deniedByDefault: false,
  },
  browser: {
    capabilities: ["requires_network", "accesses_external_api", "long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 45000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  document: {
    capabilities: ["produces_artifacts", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  message: {
    capabilities: [],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 10000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  research: {
    capabilities: ["requires_network", "accesses_external_api", "long_running"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 120000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  plan: {
    capabilities: [],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 15000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  slides: {
    capabilities: ["produces_artifacts", "writes_files"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  webdev: {
    capabilities: ["writes_files", "executes_code", "high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 60000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  schedule: {
    capabilities: ["high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 30000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  expose: {
    capabilities: ["high_risk"],
    allowedPlans: ["admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 30000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  generate: {
    capabilities: ["requires_network", "accesses_external_api", "produces_artifacts"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  web_search_retrieve: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["free", "pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 3,
    deniedByDefault: false,
  },

  // Gmail (work productivity)
  gmail_search: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  gmail_fetch: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 45000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  gmail_send: {
    capabilities: ["requires_network", "accesses_external_api", "high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 45000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  gmail_mark_read: {
    capabilities: ["requires_network", "accesses_external_api"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },

  // WhatsApp Web (work productivity)
  whatsapp_status: {
    capabilities: ["accesses_external_api"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 10000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  whatsapp_connect: {
    capabilities: ["requires_network", "accesses_external_api", "long_running"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 60000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  whatsapp_disconnect: {
    capabilities: ["accesses_external_api"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  whatsapp_send_text: {
    capabilities: ["requires_network", "accesses_external_api", "high_risk"],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: true,
    maxExecutionTimeMs: 45000,
    maxRetries: 1,
    deniedByDefault: false,
  },
  whatsapp_search_messages: {
    capabilities: [],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 20000,
    maxRetries: 2,
    deniedByDefault: false,
  },
  whatsapp_recent_messages: {
    capabilities: [],
    allowedPlans: ["pro", "admin"],
    requiresConfirmation: false,
    maxExecutionTimeMs: 30000,
    maxRetries: 2,
    deniedByDefault: false,
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
  workspaceId?: string;
  isConfirmed?: boolean;
}

export class PolicyEngine {
  private policies: Map<string, ToolPolicy> = new Map();
  private callCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private auditLog: PolicyDecisionAudit[] = [];

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
    const result = this._checkAccessInternal(context);
    this.recordAudit(context, result);
    return result;
  }

  private _checkAccessInternal(context: PolicyContext): PolicyCheckResult {
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

    if (policy.allowedWorkspaces && policy.allowedWorkspaces.length > 0) {
      if (!context.workspaceId || !policy.allowedWorkspaces.includes(context.workspaceId)) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `Tool ${context.toolName} is not enabled for the current workspace`,
          policy,
        };
      }
    }

    if (policy.rateLimit) {
      const key = `${context.userId}:${context.toolName}`;
      const now = Date.now();
      let callData = this.callCounts.get(key);

      if (callData && now - callData.windowStart >= policy.rateLimit.windowMs) {
        callData = { count: 0, windowStart: now };
        this.callCounts.set(key, callData);
      } else if (!callData) {
        callData = { count: 0, windowStart: now };
        this.callCounts.set(key, callData);
      }

      if (callData.count >= policy.rateLimit.maxCalls) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `Rate limit exceeded for ${context.toolName}`,
          policy,
        };
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

  private recordAudit(context: PolicyContext, result: PolicyCheckResult): void {
    const entry: PolicyDecisionAudit = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      userId: context.userId,
      workspaceId: context.workspaceId,
      toolName: context.toolName,
      allowed: result.allowed,
      reason: result.reason,
      context: { ...context }
    };

    // Immutable append to in-memory audit trail, keeping last 10000
    this.auditLog.push(Object.freeze(entry));
    if (this.auditLog.length > 10000) {
      this.auditLog.shift();
    }
  }

  getAuditTrail(userId?: string): readonly PolicyDecisionAudit[] {
    if (userId) {
      return this.auditLog.filter(a => a.userId === userId);
    }
    return this.auditLog;
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

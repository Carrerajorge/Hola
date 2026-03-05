// OPA/Rego-style policy engine for agent action authorization
// Defines what actions agents can take, data access rules, and escalation paths

export interface PolicySubject {
  agentId: string;
  role: "executor" | "planner" | "reviewer" | "admin";
  clearanceLevel: number; // 0-5, higher = more trusted
  parentAgentId?: string;
}

export interface PolicyResource {
  type: "api" | "file" | "database" | "web" | "system" | "secret";
  identifier: string;
  sensitivity: "public" | "internal" | "confidential" | "restricted";
}

export interface PolicyAction {
  verb: "read" | "write" | "execute" | "delete" | "escalate";
  resource: PolicyResource;
  context: Record<string, unknown>;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiredEscalation?: EscalationRule;
  conditions?: string[];
  auditRef: string;
}

export interface EscalationRule {
  level: "human" | "senior-agent" | "admin";
  timeout: number; // ms to wait for approval
  fallback: "deny" | "allow-limited";
}

interface PolicyRule {
  id: string;
  description: string;
  priority: number;
  match: (subject: PolicySubject, action: PolicyAction) => boolean;
  decide: (subject: PolicySubject, action: PolicyAction) => PolicyDecision;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private auditLog: Array<{ timestamp: number; subject: string; action: string; decision: PolicyDecision }> = [];
  private readonly maxAuditEntries = 10_000;

  constructor() {
    this.registerDefaultPolicies();
  }

  private registerDefaultPolicies(): void {
    // Deny access to restricted resources unless clearance >= 4
    this.addRule({
      id: "restricted-resource-gate",
      description: "Restricted resources require clearance level 4+",
      priority: 100,
      match: (_, action) => action.resource.sensitivity === "restricted",
      decide: (subject) => {
        if (subject.clearanceLevel >= 4) {
          return { allowed: true, reason: "Sufficient clearance for restricted resource", auditRef: this.genRef() };
        }
        return {
          allowed: false,
          reason: "Insufficient clearance for restricted resource",
          requiredEscalation: { level: "admin", timeout: 300_000, fallback: "deny" },
          auditRef: this.genRef(),
        };
      },
    });

    // Deny destructive operations without escalation
    this.addRule({
      id: "destructive-op-escalation",
      description: "Delete operations require human escalation",
      priority: 90,
      match: (_, action) => action.verb === "delete",
      decide: (subject) => ({
        allowed: subject.role === "admin",
        reason: subject.role === "admin" ? "Admin delete permitted" : "Delete requires human approval",
        requiredEscalation: subject.role !== "admin"
          ? { level: "human", timeout: 600_000, fallback: "deny" }
          : undefined,
        auditRef: this.genRef(),
      }),
    });

    // Block system command execution for low-clearance agents
    this.addRule({
      id: "system-exec-gate",
      description: "System execution requires clearance 3+",
      priority: 80,
      match: (_, action) => action.resource.type === "system" && action.verb === "execute",
      decide: (subject) => {
        if (subject.clearanceLevel >= 3) {
          return { allowed: true, reason: "Clearance sufficient for system execution", auditRef: this.genRef() };
        }
        return {
          allowed: false,
          reason: "Low-clearance agent cannot execute system commands",
          requiredEscalation: { level: "senior-agent", timeout: 120_000, fallback: "deny" },
          auditRef: this.genRef(),
        };
      },
    });

    // Secret access requires confidential clearance
    this.addRule({
      id: "secret-access-gate",
      description: "Secret access requires clearance 2+ and read-only",
      priority: 85,
      match: (_, action) => action.resource.type === "secret",
      decide: (subject, action) => {
        if (action.verb !== "read") {
          return { allowed: false, reason: "Secrets are read-only for agents", auditRef: this.genRef() };
        }
        if (subject.clearanceLevel < 2) {
          return { allowed: false, reason: "Insufficient clearance for secret access", auditRef: this.genRef() };
        }
        return { allowed: true, reason: "Secret read access granted", auditRef: this.genRef() };
      },
    });

    // Default allow for public resources
    this.addRule({
      id: "public-default-allow",
      description: "Public resources are accessible by all agents",
      priority: 0,
      match: (_, action) => action.resource.sensitivity === "public",
      decide: () => ({ allowed: true, reason: "Public resource, access granted", auditRef: this.genRef() }),
    });
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  evaluate(subject: PolicySubject, action: PolicyAction): PolicyDecision {
    for (const rule of this.rules) {
      if (rule.match(subject, action)) {
        const decision = rule.decide(subject, action);
        this.recordAudit(subject.agentId, `${action.verb}:${action.resource.identifier}`, decision);
        return decision;
      }
    }
    // Default deny
    const defaultDeny: PolicyDecision = {
      allowed: false,
      reason: "No matching policy rule; default deny",
      auditRef: this.genRef(),
    };
    this.recordAudit(subject.agentId, `${action.verb}:${action.resource.identifier}`, defaultDeny);
    return defaultDeny;
  }

  getAuditLog(agentId?: string): typeof this.auditLog {
    if (agentId) return this.auditLog.filter((e) => e.subject === agentId);
    return [...this.auditLog];
  }

  private recordAudit(subject: string, action: string, decision: PolicyDecision): void {
    this.auditLog.push({ timestamp: Date.now(), subject, action, decision });
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-this.maxAuditEntries);
    }
  }

  private genRef(): string {
    return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

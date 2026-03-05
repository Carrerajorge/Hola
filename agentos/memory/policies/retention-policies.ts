import { EventEmitter } from "events";
import {
  AccessAuditEntry,
  DataClassification,
  MemoryEntry,
  MemoryScope,
  RetentionPolicy,
  RetentionRule,
} from "../types";

/** Storage interface that the policy engine operates against. */
export interface MemoryStore {
  list(scope?: MemoryScope[]): Promise<MemoryEntry[]>;
  delete(id: string): Promise<boolean>;
  update(id: string, patch: Partial<MemoryEntry>): Promise<void>;
}

export class RetentionPolicyEngine extends EventEmitter {
  private policies = new Map<string, RetentionPolicy>();
  private auditLog: AccessAuditEntry[] = [];
  private forgetRequests = new Set<string>(); // source identifiers that requested deletion
  private idCounter = 0;

  /** Register a retention policy. */
  addPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.id, policy);
    this.emit("policy:added", policy);
  }

  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) this.emit("policy:removed", { policyId });
    return removed;
  }

  getPolicy(policyId: string): RetentionPolicy | undefined {
    return this.policies.get(policyId);
  }

  get activePolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values()).filter((p) => p.enabled);
  }

  /** Evaluate all active policies against a memory store, deleting/updating as needed. */
  async enforce(store: MemoryStore): Promise<EnforcementReport> {
    const report: EnforcementReport = {
      scanned: 0,
      deleted: 0,
      encrypted: 0,
      errors: [],
      timestamp: new Date(),
    };

    const active = this.activePolicies;
    if (active.length === 0) return report;

    // Gather all scopes referenced by active policies
    const scopes = new Set<MemoryScope>();
    for (const policy of active) {
      const s = Array.isArray(policy.scope) ? policy.scope : [policy.scope];
      s.forEach((sc) => scopes.add(sc));
    }

    const entries = await store.list(Array.from(scopes));
    report.scanned = entries.length;
    const now = new Date();

    for (const entry of entries) {
      for (const policy of active) {
        const policyScopes = Array.isArray(policy.scope) ? policy.scope : [policy.scope];
        if (!policyScopes.includes(entry.scope)) continue;

        for (const rule of policy.rules) {
          try {
            const action = this.evaluateRule(rule, entry, now);
            if (action === "delete") {
              await store.delete(entry.id);
              report.deleted++;
              this.logAudit(entry.id, "system", "delete", { rule: rule.type, policyId: policy.id });
              break; // Entry is gone, skip remaining rules
            }
            if (action === "encrypt") {
              await store.update(entry.id, { encryptedAtRest: true });
              report.encrypted++;
              this.logAudit(entry.id, "system", "write", { action: "encrypt", policyId: policy.id });
            }
          } catch (err: any) {
            report.errors.push({ entryId: entry.id, policyId: policy.id, error: err.message });
          }
        }
      }
    }

    this.emit("enforcement:completed", report);
    return report;
  }

  /** Submit a right-to-forget request for a specific source. */
  async rightToForget(
    sourceIdentifier: string,
    store: MemoryStore
  ): Promise<{ deletedCount: number }> {
    this.forgetRequests.add(sourceIdentifier);
    const entries = await store.list();
    let deletedCount = 0;

    for (const entry of entries) {
      const matchesAgent = entry.source.agentId === sourceIdentifier;
      const matchesTask = entry.source.taskId === sourceIdentifier;
      const matchesConv = entry.source.conversationId === sourceIdentifier;

      if (matchesAgent || matchesTask || matchesConv) {
        await store.delete(entry.id);
        deletedCount++;
        this.logAudit(entry.id, sourceIdentifier, "delete", { reason: "right-to-forget" });
      }
    }

    this.emit("right-to-forget:executed", { sourceIdentifier, deletedCount });
    return { deletedCount };
  }

  /** Log an access audit entry. */
  logAudit(
    memoryId: string,
    accessedBy: string,
    action: AccessAuditEntry["action"],
    context: Record<string, unknown> = {}
  ): void {
    const entry: AccessAuditEntry = {
      id: `audit-${Date.now()}-${++this.idCounter}`,
      memoryId,
      accessedBy,
      action,
      timestamp: new Date(),
      context,
    };
    this.auditLog.push(entry);
    this.emit("audit:logged", entry);
  }

  /** Query audit log. */
  queryAudit(filter: {
    memoryId?: string;
    accessedBy?: string;
    action?: AccessAuditEntry["action"];
    since?: Date;
  }): AccessAuditEntry[] {
    return this.auditLog.filter((e) => {
      if (filter.memoryId && e.memoryId !== filter.memoryId) return false;
      if (filter.accessedBy && e.accessedBy !== filter.accessedBy) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.since && e.timestamp < filter.since) return false;
      return true;
    });
  }

  /** Check if a specific classification requires encryption. */
  requiresEncryption(classification: DataClassification): boolean {
    for (const policy of this.activePolicies) {
      for (const rule of policy.rules) {
        if (
          rule.type === "classification" &&
          rule.classification === classification &&
          rule.requireEncryption
        ) {
          return true;
        }
      }
    }
    return false;
  }

  get auditLogSize(): number {
    return this.auditLog.length;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private evaluateRule(
    rule: RetentionRule,
    entry: MemoryEntry,
    now: Date
  ): "delete" | "encrypt" | "keep" {
    const ageDays = (now.getTime() - entry.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const daysSinceAccess = (now.getTime() - entry.updatedAt.getTime()) / (1000 * 60 * 60 * 24);

    switch (rule.type) {
      case "ttl":
        if (rule.scope && !rule.scope.includes(entry.scope)) return "keep";
        return ageDays > rule.maxAgeDays ? "delete" : "keep";

      case "access":
        return daysSinceAccess > rule.maxDaysSinceAccess ? "delete" : "keep";

      case "importance":
        if (entry.importance < rule.minImportance && ageDays > rule.gracePeriodDays) {
          return "delete";
        }
        return "keep";

      case "classification":
        if (entry.classification.includes(rule.classification)) {
          if (ageDays > rule.maxAgeDays) return "delete";
          if (rule.requireEncryption && !entry.encryptedAtRest) return "encrypt";
        }
        return "keep";

      case "right-to-forget":
        if (
          rule.scope.includes(entry.scope) &&
          entry.source.type === rule.sourceType &&
          this.forgetRequests.has(entry.source.agentId ?? "")
        ) {
          return "delete";
        }
        return "keep";

      default:
        return "keep";
    }
  }
}

export interface EnforcementReport {
  scanned: number;
  deleted: number;
  encrypted: number;
  errors: Array<{ entryId: string; policyId: string; error: string }>;
  timestamp: Date;
}

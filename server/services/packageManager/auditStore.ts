import { Logger } from "../../lib/logger";

/**
 * Phase 1 (REQ-002): we only PLAN operations and never execute.
 *
 * Audit storage is specified as SQLite `package_operations`.
 * In Phase 1 we only provide the schema + migration text and a no-op recorder.
 * Phase 2 will introduce a real executor + durable audit writes.
 */

export interface PlanAuditPayload {
  command: string;
  packageName: string;
  managerId: string;
  action: "install" | "uninstall";
  osFamily: string;
  osDistro?: string;
  policyDecision: string;
  policyWarnings?: string[];
  requestedBy?: string | null;
}

export type PackageOperationStatus = "planned" | "executing" | "succeeded" | "failed" | "rolled_back";

/**
 * SQLite migration (NOT executed in Phase 1).
 *
 * NOTE: Use a dedicated SQLite file (e.g. `data/package-ops.sqlite`) in later phases.
 */
export const PACKAGE_OPERATIONS_SQLITE_MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS package_operations (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  manager TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  os_family TEXT,
  os_distro TEXT,
  command TEXT,
  policy_decision TEXT,
  policy_warnings TEXT, -- JSON string
  requested_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS package_operations_created_at_idx ON package_operations(created_at);
CREATE INDEX IF NOT EXISTS package_operations_requested_by_idx ON package_operations(requested_by);
`;

class PackageAuditStore {
  /**
   * Phase 1: no-op (we don't create/open SQLite yet).
   */
  async recordPlan(_payload: PlanAuditPayload): Promise<{ id: string } | null> {
    Logger.info("[PackageAuditStore] recordPlan skipped (Phase 1: no SQLite executor yet)");
    return null;
  }
}

export const packageAuditStore = new PackageAuditStore();

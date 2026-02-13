/**
 * OpenClaw 1000 Integration Tracker
 * Tracks progress of implementing each of the 1000 capabilities.
 * In-memory store with optional persistence to DB later.
 */

export type IntegrationStatus = "not_started" | "in_progress" | "completed" | "blocked";

export interface IntegrationEntry {
  capabilityId: number;
  status: IntegrationStatus;
  startedAt?: string;
  completedAt?: string;
  assignee?: string;
  filesChanged: string[];
  testsAdded: string[];
  notes: string;
  blockerReason?: string;
}

// In-memory store — can be migrated to DB table later
const integrationStore = new Map<number, IntegrationEntry>();

/**
 * Start integrating a capability.
 */
export function startIntegration(
  capabilityId: number,
  options?: { assignee?: string; notes?: string }
): IntegrationEntry {
  const entry: IntegrationEntry = {
    capabilityId,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    assignee: options?.assignee,
    filesChanged: [],
    testsAdded: [],
    notes: options?.notes || "",
  };
  integrationStore.set(capabilityId, entry);
  return entry;
}

/**
 * Update integration progress.
 */
export function updateIntegration(
  capabilityId: number,
  update: Partial<Pick<IntegrationEntry, "status" | "filesChanged" | "testsAdded" | "notes" | "blockerReason">>
): IntegrationEntry | null {
  const existing = integrationStore.get(capabilityId);
  if (!existing) return null;

  const updated: IntegrationEntry = {
    ...existing,
    ...update,
    filesChanged: update.filesChanged || existing.filesChanged,
    testsAdded: update.testsAdded || existing.testsAdded,
  };

  if (update.status === "completed" && !updated.completedAt) {
    updated.completedAt = new Date().toISOString();
  }

  integrationStore.set(capabilityId, updated);
  return updated;
}

/**
 * Mark a capability as completed.
 */
export function completeIntegration(
  capabilityId: number,
  options?: { filesChanged?: string[]; testsAdded?: string[]; notes?: string }
): IntegrationEntry | null {
  return updateIntegration(capabilityId, {
    status: "completed",
    filesChanged: options?.filesChanged,
    testsAdded: options?.testsAdded,
    notes: options?.notes,
  });
}

/**
 * Get integration status for a capability.
 */
export function getIntegrationStatus(capabilityId: number): IntegrationEntry | null {
  return integrationStore.get(capabilityId) || null;
}

/**
 * Get all tracked integrations.
 */
export function getAllIntegrations(): IntegrationEntry[] {
  return Array.from(integrationStore.values());
}

/**
 * Get integration summary stats.
 */
export function getIntegrationSummary() {
  const all = getAllIntegrations();
  return {
    totalTracked: all.length,
    notStarted: all.filter((e) => e.status === "not_started").length,
    inProgress: all.filter((e) => e.status === "in_progress").length,
    completed: all.filter((e) => e.status === "completed").length,
    blocked: all.filter((e) => e.status === "blocked").length,
    recentlyCompleted: all
      .filter((e) => e.status === "completed")
      .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""))
      .slice(0, 10),
    currentlyInProgress: all.filter((e) => e.status === "in_progress"),
  };
}

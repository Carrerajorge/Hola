/**
 * OpenClaw 1000 Gap Priority Matrix
 * Maps each stub/missing capability to a priority tier (P0-P3)
 * and the codebase module responsible for its implementation.
 *
 * P0 = Critical (user-facing, directly requested)
 * P1 = High (important extensions, near-term)
 * P2 = Medium (platform improvements, mid-term)
 * P3 = Low (nice-to-have, future)
 */

import { getGaps1000, type OpenClaw1000Capability } from "./openClaw1000Unified";

export type GapPriority = "P0" | "P1" | "P2" | "P3";

export interface GapEntry {
  id: number;
  capability: string;
  category: string;
  priority: GapPriority;
  targetModule: string;
  notes: string;
}

/**
 * Priority assignment rules by ID range and category.
 * Based on the actual codebase audit and user impact analysis.
 */
function assignPriority(cap: OpenClaw1000Capability): { priority: GapPriority; targetModule: string; notes: string } {
  const { id, category } = cap;

  // ── P0: Critical user-facing gaps ──
  // Academic text analysis (IMRyD, methodology, results, conclusions)
  if (id >= 18 && id <= 29) return { priority: "P0", targetModule: "server/services/academicTextAnalysis.ts", notes: "Academic text extraction — direct user request" };
  // Vancouver, RIS citation formats
  if (id === 35) return { priority: "P0", targetModule: "server/services/CitationService.ts", notes: "Vancouver citation format" };
  if (id === 37) return { priority: "P0", targetModule: "server/services/CitationService.ts", notes: "RIS export format" };
  // Library management (save, version, classify, alerts)
  if (id >= 41 && id <= 50) return { priority: "P0", targetModule: "server/services/libraryService.ts", notes: "Paper library management — users need this" };
  // Agent checkpoints and operation modes
  if (id === 264 || id === 265) return { priority: "P0", targetModule: "server/agent/checkpointManager.ts", notes: "Agent pause/resume — critical for long tasks" };
  if (id >= 272 && id <= 280) return { priority: "P0", targetModule: "server/agent/operationModes.ts", notes: "Agent operation modes (8 modes)" };
  if (id === 283) return { priority: "P0", targetModule: "server/services/agentKPIs.ts", notes: "Agent KPIs dashboard" };

  // ── P1: Important extensions ──
  // Web search advanced features
  if (category === "web_realtime_search" && cap.status === "stub") return { priority: "P1", targetModule: "server/services/webSearch.ts", notes: "Web search extension" };
  // Document templates
  if (id >= 220 && id <= 229) return { priority: "P1", targetModule: "server/services/documentTemplates.ts", notes: "Document template system" };
  // Agent metrics and testing
  if (id >= 283 && id <= 300) return { priority: "P1", targetModule: "server/services/agentKPIs.ts", notes: "Agent metrics and testing" };
  // Platform messaging features
  if (category === "platform_messaging_ops_security" && id >= 301 && id <= 400 && cap.status === "stub") return { priority: "P1", targetModule: "server/routes/", notes: "Platform feature — chat/sessions/tools" };
  // Code intelligence
  if (category === "code_intelligence_repo_ops") return { priority: "P1", targetModule: "server/services/codeAnalysis.ts", notes: "Code intelligence tools" };
  // Connectors
  if (category === "connectors_data_workflows") return { priority: "P1", targetModule: "server/services/connectors/", notes: "External service connectors" };
  // AI cores
  if (category === "ai_super_person_cores" && cap.status === "stub") return { priority: "P1", targetModule: "server/services/modelIntegration.ts", notes: "AI core capabilities" };

  // ── P2: Platform improvements ──
  // Security compliance
  if (category === "security_identity_compliance" && cap.status === "stub") return { priority: "P2", targetModule: "server/services/advancedSecurity.ts", notes: "Security hardening" };
  // Observability
  if (category === "observability_reliability" && cap.status === "stub") return { priority: "P2", targetModule: "server/lib/telemetry.ts", notes: "Observability extension" };
  // Infrastructure
  if (category === "infra_cloud_containers") return { priority: "P2", targetModule: "server/services/infraService.ts", notes: "Infrastructure automation — agent-assisted" };
  // Knowledge/RAG
  if (category === "knowledge_rag_memory" && cap.status === "stub") return { priority: "P2", targetModule: "server/services/ragService.ts", notes: "RAG pipeline extension" };
  // RPA advanced
  if (category === "advanced_rpa_computer_use") return { priority: "P2", targetModule: "server/services/browserToolApi.ts", notes: "Advanced RPA capabilities" };
  // Enterprise
  if (category === "enterprise_governance_collaboration") return { priority: "P2", targetModule: "server/services/governanceService.ts", notes: "Enterprise governance" };
  // Platform ops (400-500)
  if (category === "platform_messaging_ops_security" && id >= 400) return { priority: "P2", targetModule: "server/services/", notes: "Platform ops and scaling" };

  // ── P3: Everything else ──
  return { priority: "P3", targetModule: "TBD", notes: "Future / nice-to-have" };
}

/**
 * Build the full gap priority list from current data.
 */
export function buildGapPriorityMatrix(): GapEntry[] {
  const gaps = getGaps1000();
  return gaps.map((cap) => {
    const { priority, targetModule, notes } = assignPriority(cap);
    return {
      id: cap.id,
      capability: cap.capability,
      category: cap.category,
      priority,
      targetModule,
      notes,
    };
  });
}

/**
 * Get gaps grouped by priority tier.
 */
export function getGapsByPriority(): Record<GapPriority, GapEntry[]> {
  const matrix = buildGapPriorityMatrix();
  const result: Record<GapPriority, GapEntry[]> = { P0: [], P1: [], P2: [], P3: [] };
  for (const entry of matrix) {
    result[entry.priority].push(entry);
  }
  return result;
}

/**
 * Get summary stats for the gap matrix.
 */
export function getGapPrioritySummary() {
  const byPriority = getGapsByPriority();
  return {
    total: Object.values(byPriority).flat().length,
    P0: byPriority.P0.length,
    P1: byPriority.P1.length,
    P2: byPriority.P2.length,
    P3: byPriority.P3.length,
    P0_categories: [...new Set(byPriority.P0.map((g) => g.category))],
    P1_categories: [...new Set(byPriority.P1.map((g) => g.category))],
  };
}

/**
 * Get roadmap: ordered list of what to implement next.
 */
export function getRoadmap() {
  const byPriority = getGapsByPriority();
  return {
    phases: [
      { name: "Fase B: Critical Gaps (P0)", description: "User-facing features that are directly requested", items: byPriority.P0 },
      { name: "Fase C: Important Extensions (P1)", description: "Extensions that add significant value", items: byPriority.P1 },
      { name: "Fase D: Platform Improvements (P2)", description: "Infrastructure, security, and governance", items: byPriority.P2 },
      { name: "Future (P3)", description: "Nice-to-have features for future sprints", items: byPriority.P3 },
    ],
    summary: getGapPrioritySummary(),
  };
}

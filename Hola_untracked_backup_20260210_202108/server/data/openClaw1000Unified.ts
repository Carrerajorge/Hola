/**
 * OpenClaw 1000 Unified Capabilities
 * Single source of truth combining openClaw500Mapping (IDs 1-500)
 * and openClaw1000Extended (IDs 501-1000) into one queryable dataset.
 * Aligned with the OpenClaw_1000_Prompts_Integracion document taxonomy.
 */

import { OPENCLAW_500, type CapabilityStatus, type OpenClawCapability } from "./openClaw500Mapping";
import { OPENCLAW_EXTENDED, type OpenClawExtendedCapability } from "./openClaw1000Extended";

// ═══════════════════════════════════════════════════════════════════
// Category Taxonomy — all 16 categories from the 1000-prompt doc
// ═══════════════════════════════════════════════════════════════════

export type OpenClaw1000Category =
  | "academic_research"
  | "web_realtime_search"
  | "browser_automation"
  | "documents_and_library"
  | "agent_autonomy_multiagent"
  | "platform_messaging_ops_security"
  | "terminal_execution_chatops"
  | "code_intelligence_repo_ops"
  | "infra_cloud_containers"
  | "security_identity_compliance"
  | "observability_reliability"
  | "connectors_data_workflows"
  | "ai_super_person_cores"
  | "knowledge_rag_memory"
  | "enterprise_governance_collaboration"
  | "advanced_rpa_computer_use";

export interface CategoryMeta {
  displayName: string;
  displayNameEs: string;
  range: [number, number];
  nucleus: string;
  nucleusKey: string;
  count: number;
}

export const CATEGORY_META: Record<OpenClaw1000Category, CategoryMeta> = {
  academic_research: {
    displayName: "Academic Research",
    displayNameEs: "Investigación Académica",
    range: [1, 50],
    nucleus: "Conocimiento",
    nucleusKey: "core_knowledge",
    count: 50,
  },
  web_realtime_search: {
    displayName: "Web & Real-time Search",
    displayNameEs: "Búsqueda Web en Tiempo Real",
    range: [51, 100],
    nucleus: "Conocimiento",
    nucleusKey: "core_knowledge",
    count: 50,
  },
  browser_automation: {
    displayName: "Browser Automation",
    displayNameEs: "Automatización de Navegador",
    range: [101, 160],
    nucleus: "Acción",
    nucleusKey: "core_action",
    count: 60,
  },
  documents_and_library: {
    displayName: "Documents & Library",
    displayNameEs: "Documentos y Biblioteca",
    range: [161, 230],
    nucleus: "Documentos",
    nucleusKey: "core_docs",
    count: 70,
  },
  agent_autonomy_multiagent: {
    displayName: "Agent Autonomy & Multi-Agent",
    displayNameEs: "Autonomía y Multi-Agente",
    range: [231, 300],
    nucleus: "Planificación",
    nucleusKey: "core_planning",
    count: 70,
  },
  platform_messaging_ops_security: {
    displayName: "Platform, Messaging, Ops & Security",
    displayNameEs: "Plataforma, Mensajería, Ops y Seguridad",
    range: [301, 500],
    nucleus: "Comunicación",
    nucleusKey: "core_comms",
    count: 200,
  },
  terminal_execution_chatops: {
    displayName: "Terminal Execution & ChatOps",
    displayNameEs: "Terminal Interactivo y ChatOps",
    range: [501, 550],
    nucleus: "Acción",
    nucleusKey: "core_action",
    count: 50,
  },
  code_intelligence_repo_ops: {
    displayName: "Code Intelligence & Repo Ops",
    displayNameEs: "Inteligencia de Código y Repo Ops",
    range: [551, 600],
    nucleus: "Acción",
    nucleusKey: "core_action",
    count: 50,
  },
  infra_cloud_containers: {
    displayName: "Infrastructure, Cloud & Containers",
    displayNameEs: "Infraestructura, Cloud y Contenedores",
    range: [601, 650],
    nucleus: "Orquestación",
    nucleusKey: "core_orchestration",
    count: 50,
  },
  security_identity_compliance: {
    displayName: "Security, Identity & Compliance",
    displayNameEs: "Seguridad, Identidad y Compliance",
    range: [651, 700],
    nucleus: "Seguridad",
    nucleusKey: "core_security",
    count: 50,
  },
  observability_reliability: {
    displayName: "Observability & Reliability",
    displayNameEs: "Observabilidad y Resiliencia",
    range: [701, 750],
    nucleus: "Observabilidad",
    nucleusKey: "core_observability",
    count: 50,
  },
  connectors_data_workflows: {
    displayName: "Connectors, Data & Workflows",
    displayNameEs: "Conectores, Datos y Workflows",
    range: [751, 800],
    nucleus: "Orquestación",
    nucleusKey: "core_orchestration",
    count: 50,
  },
  ai_super_person_cores: {
    displayName: "AI Super-Person Cores",
    displayNameEs: "Núcleos de Super-Persona IA",
    range: [801, 850],
    nucleus: "Planificación",
    nucleusKey: "core_planning",
    count: 50,
  },
  knowledge_rag_memory: {
    displayName: "Knowledge, RAG & Memory",
    displayNameEs: "Conocimiento, RAG y Memoria",
    range: [851, 900],
    nucleus: "Conocimiento",
    nucleusKey: "core_knowledge",
    count: 50,
  },
  enterprise_governance_collaboration: {
    displayName: "Enterprise Governance & Collaboration",
    displayNameEs: "Gobernanza Empresarial y Colaboración",
    range: [901, 950],
    nucleus: "Gobernanza",
    nucleusKey: "core_governance",
    count: 50,
  },
  advanced_rpa_computer_use: {
    displayName: "Advanced RPA & Computer Use",
    displayNameEs: "RPA Avanzada y Uso de Computador",
    range: [951, 1000],
    nucleus: "Percepción",
    nucleusKey: "core_perception",
    count: 50,
  },
};

// ═══════════════════════════════════════════════════════════════════
// Unified Capability Interface
// ═══════════════════════════════════════════════════════════════════

export interface OpenClaw1000Capability {
  id: number;
  capability: string;
  category: OpenClaw1000Category;
  toolName: string;
  status: CapabilityStatus;
  permissionProfiles: string[];
  promptId: number; // same as id — links to the prompt document
}

// ═══════════════════════════════════════════════════════════════════
// Category mapping from extended → document taxonomy
// ═══════════════════════════════════════════════════════════════════

const EXTENDED_TO_UNIFIED_CATEGORY: Record<string, OpenClaw1000Category> = {
  terminal_interactive: "terminal_execution_chatops",
  code_dev_tools: "code_intelligence_repo_ops",
  containers_infrastructure: "infra_cloud_containers",
  security_compliance: "security_identity_compliance",
  observability_monitoring: "observability_reliability",
  connectors_integrations: "connectors_data_workflows",
  ai_agent_core: "ai_super_person_cores",
  rag_knowledge: "knowledge_rag_memory",
  enterprise_features: "enterprise_governance_collaboration",
  browser_automation_advanced: "advanced_rpa_computer_use",
};

// ═══════════════════════════════════════════════════════════════════
// Build unified array
// ═══════════════════════════════════════════════════════════════════

function buildUnified(): OpenClaw1000Capability[] {
  const from500: OpenClaw1000Capability[] = OPENCLAW_500.map((c) => ({
    id: c.id,
    capability: c.capability,
    category: c.category as OpenClaw1000Category,
    toolName: c.toolName,
    status: c.status,
    permissionProfiles: c.permissionProfiles,
    promptId: c.id,
  }));

  const from1000: OpenClaw1000Capability[] = OPENCLAW_EXTENDED.map((c) => ({
    id: c.id,
    capability: c.capability,
    category: (EXTENDED_TO_UNIFIED_CATEGORY[c.category] || c.category) as OpenClaw1000Category,
    toolName: c.toolName,
    status: c.status,
    permissionProfiles: c.permissionProfiles,
    promptId: c.id,
  }));

  return [...from500, ...from1000].sort((a, b) => a.id - b.id);
}

export const OPENCLAW_1000: OpenClaw1000Capability[] = buildUnified();

// ═══════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════

/** Lookup by ID (1-1000) */
export function getCapabilityById1000(id: number): OpenClaw1000Capability | undefined {
  return OPENCLAW_1000.find((c) => c.id === id);
}

/** Filter by category */
export function getByCategory1000(category: OpenClaw1000Category): OpenClaw1000Capability[] {
  return OPENCLAW_1000.filter((c) => c.category === category);
}

/** Filter by status */
export function getByStatus1000(status: CapabilityStatus): OpenClaw1000Capability[] {
  return OPENCLAW_1000.filter((c) => c.status === status);
}

/** Get all gaps (stub + missing) */
export function getGaps1000(): OpenClaw1000Capability[] {
  return OPENCLAW_1000.filter((c) => c.status === "stub" || c.status === "missing");
}

/** Get all gaps in a specific category */
export function getGapsByCategory1000(category: OpenClaw1000Category): OpenClaw1000Capability[] {
  return OPENCLAW_1000.filter(
    (c) => c.category === category && (c.status === "stub" || c.status === "missing")
  );
}

/** Full stats across all 1000 capabilities */
export function getStats1000() {
  const total = OPENCLAW_1000.length;
  const implemented = OPENCLAW_1000.filter((c) => c.status === "implemented").length;
  const partial = OPENCLAW_1000.filter((c) => c.status === "partial").length;
  const stub = OPENCLAW_1000.filter((c) => c.status === "stub").length;
  const missing = OPENCLAW_1000.filter((c) => c.status === "missing").length;

  const coveragePercent = Math.round(((implemented + partial) / total) * 100 * 10) / 10;

  const byCategory = {} as Record<
    OpenClaw1000Category,
    { total: number; implemented: number; partial: number; stub: number; missing: number; coveragePercent: number }
  >;

  for (const c of OPENCLAW_1000) {
    if (!byCategory[c.category]) {
      byCategory[c.category] = { total: 0, implemented: 0, partial: 0, stub: 0, missing: 0, coveragePercent: 0 };
    }
    byCategory[c.category].total++;
    byCategory[c.category][c.status]++;
  }

  // Calculate per-category coverage
  for (const cat of Object.keys(byCategory) as OpenClaw1000Category[]) {
    const s = byCategory[cat];
    s.coveragePercent = Math.round(((s.implemented + s.partial) / s.total) * 100 * 10) / 10;
  }

  return {
    total,
    implemented,
    partial,
    stub,
    missing,
    coveragePercent,
    byCategory,
  };
}

/** Get list of all category keys */
export function getAllCategories(): OpenClaw1000Category[] {
  return Object.keys(CATEGORY_META) as OpenClaw1000Category[];
}

/** Search capabilities by keyword in name */
export function searchCapabilities(query: string): OpenClaw1000Capability[] {
  const q = query.toLowerCase();
  return OPENCLAW_1000.filter((c) => c.capability.toLowerCase().includes(q));
}

/** Get capabilities in an ID range */
export function getByRange(from: number, to: number): OpenClaw1000Capability[] {
  return OPENCLAW_1000.filter((c) => c.id >= from && c.id <= to);
}

// Re-export base types for convenience
export type { CapabilityStatus };

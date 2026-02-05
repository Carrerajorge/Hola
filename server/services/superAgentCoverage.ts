import { ALL_TOOLS } from "../agent/langgraph/tools";
import { SUPER_AGENT_CAPABILITIES, type SuperAgentCapability } from "../data/superAgentCapabilities";
import { CAPABILITY_REQUIREMENTS, SECTION_REQUIREMENTS, type CapabilityRequirement } from "../data/superAgentRequirements";

export type CoverageStatus = "covered" | "partial" | "missing";

export interface ToolMatch {
  name: string;
  description: string;
  score: number;
  matchedTokens: string[];
}

export interface CapabilityCoverage {
  capability: SuperAgentCapability;
  status: CoverageStatus;
  matches: ToolMatch[];
  requirements?: CapabilityRequirement;
  availability: CapabilityAvailability;
}

export interface CoverageSummary {
  total: number;
  covered: number;
  partial: number;
  missing: number;
  ready: number;
  blocked: number;
}

export interface CapabilityAvailability {
  osSupported: boolean;
  envSatisfied: boolean;
  missingEnv: string[];
  ready: boolean;
  notes?: string;
}

const STOPWORDS = new Set([
  "de", "y", "la", "el", "los", "las", "un", "una", "unos", "unas", "para", "por", "en", "con", "sin", "sobre", "entre", "al", "del",
  "a", "o", "u", "e", "que", "su", "sus", "se", "es", "como", "mas", "menos", "muy", "ya", "no",
  "and", "or", "the", "a", "an", "to", "for", "with", "without", "on", "in", "of", "by", "from",
]);

const EXPANSIONS: Record<string, string[]> = {
  correo: ["email", "mail"],
  email: ["correo"],
  whatsapp: ["mensajeria", "mensaje", "chat"],
  mensajeria: ["whatsapp", "mensaje"],
  calendario: ["calendar", "agenda", "schedule", "cron"],
  agenda: ["calendar", "calendario"],
  archivos: ["file", "files", "document"],
  archivo: ["file", "document"],
  documento: ["document", "doc", "docx"],
  word: ["docx", "documento"],
  excel: ["xlsx", "spreadsheet", "hoja"],
  powerpoint: ["pptx", "presentacion", "slides"],
  presentacion: ["pptx", "slides", "powerpoint"],
  ocr: ["tesseract", "imagen", "texto"],
  imagen: ["image", "ocr", "vision"],
  backup: ["respaldo", "copia", "restaurar"],
  respaldo: ["backup", "restaurar"],
  seguridad: ["security", "audit", "compliance"],
  monitor: ["monitoring", "metrics", "alert"],
  monitoreo: ["monitoring", "metrics", "alert"],
  web: ["browser", "navigate", "scrape"],
  navegador: ["browser", "web"],
  codigo: ["code", "programacion", "dev"],
  programacion: ["code", "dev"],
  datos: ["data", "analytics", "analysis"],
  memoria: ["memory", "context", "history"],
  aprendizaje: ["learning", "feedback"],
  integraciones: ["integration", "api", "webhook"],
  base: ["database", "db", "sql"],
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function tokenize(value: string): string[] {
  if (!value) return [];
  const raw = stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const tokens: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    if (token.length <= 2 && !["ai", "ml", "ocr", "sql", "api", "os", "db"].includes(token)) {
      continue;
    }
    tokens.push(token);
    const expansion = EXPANSIONS[token];
    if (expansion) {
      for (const extra of expansion) {
        tokens.push(extra);
      }
    }
  }

  return Array.from(new Set(tokens));
}

function getToolText(tool: any): { name: string; description: string } {
  const name = tool?.name ?? tool?.lc_kwargs?.name ?? "";
  const description = tool?.description ?? tool?.lc_kwargs?.description ?? "";
  return { name: String(name), description: String(description) };
}

function scoreTokens(capTokens: Set<string>, toolTokens: Set<string>): { score: number; matched: string[] } {
  if (capTokens.size === 0 || toolTokens.size === 0) return { score: 0, matched: [] };
  const matched: string[] = [];
  for (const token of capTokens) {
    if (toolTokens.has(token)) matched.push(token);
  }
  const score = matched.length / capTokens.size;
  return { score, matched };
}

function mergeRequirements(base?: CapabilityRequirement, override?: CapabilityRequirement): CapabilityRequirement | undefined {
  if (!base && !override) return undefined;
  const env = [...(base?.env ?? []), ...(override?.env ?? [])];
  const envAnyOf = [...(base?.envAnyOf ?? []), ...(override?.envAnyOf ?? [])];
  const os = override?.os ?? base?.os;
  const notes = [base?.notes, override?.notes].filter(Boolean).join(" / ");
  return {
    env: env.length ? Array.from(new Set(env)) : undefined,
    envAnyOf: envAnyOf.length ? envAnyOf : undefined,
    os,
    notes: notes || undefined,
  };
}

function isEnvSet(key: string): boolean {
  const value = process.env[key];
  return Boolean(value && value.trim().length > 0);
}

function evaluateAvailability(requirements?: CapabilityRequirement): CapabilityAvailability {
  const osSupported = !requirements?.os || requirements.os.includes(process.platform as any);

  const missingEnv = new Set<string>();
  let envSatisfied = true;

  if (requirements?.env && requirements.env.length > 0) {
    for (const key of requirements.env) {
      if (!isEnvSet(key)) {
        missingEnv.add(key);
        envSatisfied = false;
      }
    }
  }

  if (requirements?.envAnyOf && requirements.envAnyOf.length > 0) {
    const anySatisfied = requirements.envAnyOf.some(group =>
      group.every(key => isEnvSet(key))
    );
    if (!anySatisfied) {
      envSatisfied = false;
      for (const group of requirements.envAnyOf) {
        for (const key of group) {
          if (!isEnvSet(key)) missingEnv.add(key);
        }
      }
    }
  }

  const ready = osSupported && envSatisfied;

  return {
    osSupported,
    envSatisfied,
    missingEnv: Array.from(missingEnv),
    ready,
    notes: requirements?.notes,
  };
}

export function getSuperAgentCoverage(): { summary: CoverageSummary; capabilities: CapabilityCoverage[] } {
  const tools = ALL_TOOLS.map((tool) => {
    const { name, description } = getToolText(tool);
    const tokens = new Set([...tokenize(name), ...tokenize(description)]);
    return { name, description, tokens };
  });

  const capabilities: CapabilityCoverage[] = SUPER_AGENT_CAPABILITIES.map((capability) => {
    const requirements = mergeRequirements(
      SECTION_REQUIREMENTS[capability.section],
      CAPABILITY_REQUIREMENTS[capability.id]
    );
    const availability = evaluateAvailability(requirements);

    const capTokens = new Set([
      ...tokenize(capability.title),
      ...tokenize(capability.section),
      ...capability.tags,
    ]);

    const matches: ToolMatch[] = tools
      .map((tool) => {
        const { score, matched } = scoreTokens(capTokens, tool.tokens);
        return {
          name: tool.name,
          description: tool.description,
          score,
          matchedTokens: matched,
        };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const topScore = matches[0]?.score ?? 0;
    let status: CoverageStatus = "missing";
    if (topScore >= 0.45) {
      status = "covered";
    } else if (topScore >= 0.25) {
      status = "partial";
    }

    return {
      capability,
      status,
      matches,
      requirements,
      availability,
    };
  });

  const summary: CoverageSummary = {
    total: capabilities.length,
    covered: capabilities.filter((c) => c.status === "covered").length,
    partial: capabilities.filter((c) => c.status === "partial").length,
    missing: capabilities.filter((c) => c.status === "missing").length,
    ready: capabilities.filter((c) => c.availability.ready).length,
    blocked: capabilities.filter((c) => !c.availability.ready).length,
  };

  return { summary, capabilities };
}

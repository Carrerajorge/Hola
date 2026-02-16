/**
 * parseOpenClawPrompts.ts
 *
 * Reads OpenClaw_1000_Prompts_Integracion.txt and generates
 * server/data/openClaw1000Prompts.ts with all 1000 prompts
 * as structured TypeScript objects.
 *
 * Usage: npx tsx scripts/parseOpenClawPrompts.ts [path-to-txt]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsedPrompt {
  id: number;
  title: string;
  category: string;
  nucleus: string;
  nucleusKey: string;
  techTags: string[];
  role: string;
  objective: string;
  systemContext: string[];
  inputs: string[];
  integrationTasks: string[];
  acceptanceCriteria: string[];
  deliverables: string[];
  securityRules: string[];
  notes: string;
}

function parsePromptBlock(block: string): ParsedPrompt | null {
  const lines = block.split("\n");

  // Extract header: ===== PROMPT 0001 — Title =====
  const headerMatch = lines[0]?.match(/^===== PROMPT (\d+) — (.+?) =====$/);
  if (!headerMatch) return null;

  const id = parseInt(headerMatch[1], 10);
  const title = headerMatch[2].trim();

  // Extract category line
  const catLine = lines[1] || "";
  const catMatch = catLine.match(/^Categoría:\s*(\S+)\s*\|\s*Núcleo:\s*(.+?)\s*\((\w+)\)\s*\|\s*Tech tags:\s*(.+)$/);

  const category = catMatch?.[1]?.trim() || "unknown";
  const nucleus = catMatch?.[2]?.trim() || "unknown";
  const nucleusKey = catMatch?.[3]?.trim() || "unknown";
  const techTags = catMatch?.[4]?.split(",").map((t) => t.trim()).filter(Boolean) || [];

  // Parse sections
  let currentSection = "";
  const sections: Record<string, string[]> = {
    role: [],
    objective: [],
    context: [],
    inputs: [],
    tasks: [],
    criteria: [],
    deliverables: [],
    security: [],
    notes: [],
    format: [],
  };

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "ROL") { currentSection = "role"; continue; }
    if (trimmed === "OBJETIVO") { currentSection = "objective"; continue; }
    if (trimmed.startsWith("CONTEXTO DEL SISTEMA")) { currentSection = "context"; continue; }
    if (trimmed.startsWith("ENTRADAS QUE DEBES")) { currentSection = "inputs"; continue; }
    if (trimmed.startsWith("TAREAS DE INTEGRACIÓN")) { currentSection = "tasks"; continue; }
    if (trimmed.startsWith("CRITERIOS DE ACEPTACIÓN")) { currentSection = "criteria"; continue; }
    if (trimmed.startsWith("SALIDAS OBLIGATORIAS")) { currentSection = "deliverables"; continue; }
    if (trimmed.startsWith("SEGURIDAD Y GOBERNANZA")) { currentSection = "security"; continue; }
    if (trimmed.startsWith("FORMATO DE RESPUESTA")) { currentSection = "format"; continue; }
    if (trimmed === "NOTAS") { currentSection = "notes"; continue; }

    if (currentSection && trimmed) {
      sections[currentSection].push(trimmed);
    }
  }

  return {
    id,
    title,
    category,
    nucleus,
    nucleusKey,
    techTags,
    role: sections.role.join(" "),
    objective: sections.objective.join(" "),
    systemContext: sections.context.filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, "")),
    inputs: sections.inputs.filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, "")),
    integrationTasks: sections.tasks.filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, "")),
    acceptanceCriteria: sections.criteria.filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, "")),
    deliverables: sections.deliverables.filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, "")),
    securityRules: sections.security.filter((l) => l.startsWith("-")).map((l) => l.replace(/^-\s*/, "")),
    notes: sections.notes.join(" "),
  };
}

function main() {
  const inputPath = process.argv[2] || path.join(
    process.env.HOME || "/Users/ale",
    "Downloads",
    "OpenClaw_1000_Prompts_Integracion.txt"
  );

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  console.log(`Reading: ${inputPath}`);
  const raw = fs.readFileSync(inputPath, "utf-8");

  // Split by prompt headers
  const blocks = raw.split(/(?=^===== PROMPT \d{4})/m).filter((b) => b.startsWith("===== PROMPT"));

  console.log(`Found ${blocks.length} prompt blocks`);

  const prompts: ParsedPrompt[] = [];
  const errors: number[] = [];

  for (const block of blocks) {
    const parsed = parsePromptBlock(block);
    if (parsed) {
      prompts.push(parsed);
    } else {
      const idMatch = block.match(/PROMPT (\d+)/);
      errors.push(idMatch ? parseInt(idMatch[1], 10) : -1);
    }
  }

  console.log(`Parsed: ${prompts.length} prompts`);
  if (errors.length > 0) {
    console.warn(`Failed to parse IDs: ${errors.join(", ")}`);
  }

  // Sort by ID
  prompts.sort((a, b) => a.id - b.id);

  // Verify completeness
  const ids = new Set(prompts.map((p) => p.id));
  const missing: number[] = [];
  for (let i = 1; i <= 1000; i++) {
    if (!ids.has(i)) missing.push(i);
  }
  if (missing.length > 0) {
    console.warn(`Missing IDs: ${missing.join(", ")}`);
  }

  // Generate TypeScript file
  const outputPath = path.join(__dirname, "..", "server", "data", "openClaw1000Prompts.ts");

  const tsContent = `/**
 * OpenClaw 1000 Prompts — Structured Data
 * Auto-generated by scripts/parseOpenClawPrompts.ts
 * Source: OpenClaw_1000_Prompts_Integracion.txt
 * Generated: ${new Date().toISOString()}
 * Total prompts: ${prompts.length}
 */

export interface OpenClawPrompt {
  id: number;
  title: string;
  category: string;
  nucleus: string;
  nucleusKey: string;
  techTags: string[];
  role: string;
  objective: string;
  systemContext: string[];
  inputs: string[];
  integrationTasks: string[];
  acceptanceCriteria: string[];
  deliverables: string[];
  securityRules: string[];
  notes: string;
}

export const OPENCLAW_1000_PROMPTS: OpenClawPrompt[] = ${JSON.stringify(prompts, null, 2)};

/** Lookup a prompt by ID (1-1000) */
export function getPromptById(id: number): OpenClawPrompt | undefined {
  return OPENCLAW_1000_PROMPTS.find((p) => p.id === id);
}

/** Get all prompts in a category */
export function getPromptsByCategory(category: string): OpenClawPrompt[] {
  return OPENCLAW_1000_PROMPTS.filter((p) => p.category === category);
}

/** Search prompts by keyword in title */
export function searchPrompts(query: string): OpenClawPrompt[] {
  const q = query.toLowerCase();
  return OPENCLAW_1000_PROMPTS.filter((p) => p.title.toLowerCase().includes(q));
}

/** Get all unique categories */
export function getPromptCategories(): string[] {
  return [...new Set(OPENCLAW_1000_PROMPTS.map((p) => p.category))];
}

/** Get stats about the prompts */
export function getPromptStats() {
  const byCategory: Record<string, number> = {};
  for (const p of OPENCLAW_1000_PROMPTS) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }
  return { total: OPENCLAW_1000_PROMPTS.length, byCategory };
}
`;

  fs.writeFileSync(outputPath, tsContent, "utf-8");
  console.log(`Written: ${outputPath}`);

  // Print summary
  const catCounts: Record<string, number> = {};
  for (const p of prompts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }
  console.log("\nCategory breakdown:");
  for (const [cat, count] of Object.entries(catCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${cat}: ${count}`);
  }

  // Spot check
  const first = prompts[0];
  const last = prompts[prompts.length - 1];
  console.log(`\nFirst: #${first.id} — ${first.title} (${first.integrationTasks.length} tasks)`);
  console.log(`Last:  #${last.id} — ${last.title} (${last.integrationTasks.length} tasks)`);
}

main();

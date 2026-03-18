import fs from "node:fs/promises";
import path from "node:path";

export type ClawiExtensionCapability = {
  id: string;
  name: string;
  description?: string;
  path: string;
};

export type ClawiSkillCapability = {
  id: string;
  name: string;
  path: string;
};

export type ClawiToolCapability = {
  id: string;
  path: string;
};

export type ClawiCatalog = {
  sourceRoot: string;
  loadedAt: string;
  skills: ClawiSkillCapability[];
  extensions: ClawiExtensionCapability[];
  agentTools: ClawiToolCapability[];
};

const DEFAULT_CLAWI_ROOT = path.resolve(process.cwd(), "server", "openclaw");
const MAX_ENTRIES_PER_SECTION = 80;
const CACHE_TTL_MS = 60_000;

let cachedCatalog: ClawiCatalog | null = null;
let cachedAt = 0;

function normalizeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function discoverSkills(root: string): Promise<ClawiSkillCapability[]> {
  const skillsRoot = path.join(root, "skills");
  if (!(await dirExists(skillsRoot))) return [];

  const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  const skills: ClawiSkillCapability[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = path.join(skillsRoot, entry.name);
    if (!(await fileExists(path.join(skillPath, "SKILL.md")))) continue;
    skills.push({
      id: normalizeId(entry.name),
      name: entry.name,
      path: skillPath,
    });
  }
  return skills.slice(0, MAX_ENTRIES_PER_SECTION);
}

async function discoverExtensions(root: string): Promise<ClawiExtensionCapability[]> {
  const extensionsRoot = path.join(root, "extensions");
  if (!(await dirExists(extensionsRoot))) return [];

  const entries = await fs.readdir(extensionsRoot, { withFileTypes: true });
  const extensions: ClawiExtensionCapability[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const extPath = path.join(extensionsRoot, entry.name);
    const pkg = await readJson(path.join(extPath, "package.json"));
    extensions.push({
      id: normalizeId(entry.name),
      name: (pkg?.name as string) || entry.name,
      description: (pkg?.description as string) || undefined,
      path: extPath,
    });
  }
  return extensions.slice(0, MAX_ENTRIES_PER_SECTION);
}

async function discoverAgentTools(root: string): Promise<ClawiToolCapability[]> {
  const toolsRoot = path.join(root, "src", "agents", "tools");
  if (!(await dirExists(toolsRoot))) return [];

  const entries = await fs.readdir(toolsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .slice(0, MAX_ENTRIES_PER_SECTION)
    .map((entry) => ({
      id: normalizeId(entry.name.replace(/\.ts$/i, "")),
      path: path.join(toolsRoot, entry.name),
    }));
}

export async function getClawiCatalog(forceRefresh = false): Promise<ClawiCatalog> {
  const now = Date.now();
  if (!forceRefresh && cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  const sourceRoot = process.env.CLAWI_ROOT_DIR
    ? path.resolve(process.env.CLAWI_ROOT_DIR)
    : DEFAULT_CLAWI_ROOT;

  const [skills, extensions, agentTools] = await Promise.all([
    discoverSkills(sourceRoot),
    discoverExtensions(sourceRoot),
    discoverAgentTools(sourceRoot),
  ]);

  cachedCatalog = {
    sourceRoot,
    loadedAt: new Date(now).toISOString(),
    skills,
    extensions,
    agentTools,
  };
  cachedAt = now;
  return cachedCatalog;
}

function topItems(values: string[], limit: number): string {
  if (values.length === 0) return "(none)";
  return values.slice(0, limit).join(", ");
}

export async function buildClawiCapabilitiesSummary(options: { maxItems?: number } = {}): Promise<string> {
  const maxItems = options.maxItems ?? 12;
  const catalog = await getClawiCatalog();

  return [
    "[Clawi Capabilities Catalog]",
    `sourceRoot: ${catalog.sourceRoot}`,
    `skills(${catalog.skills.length}): ${topItems(catalog.skills.map((item) => item.id), maxItems)}`,
    `extensions(${catalog.extensions.length}): ${topItems(catalog.extensions.map((item) => item.id), maxItems)}`,
    `agentTools(${catalog.agentTools.length}): ${topItems(catalog.agentTools.map((item) => item.id), maxItems)}`,
  ].join("\n");
}

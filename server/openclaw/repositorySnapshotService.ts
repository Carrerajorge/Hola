import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import type { OpenClawWorkspaceContext } from "@shared/openclawWorkspaceContext";
import type {
  OpenClawPackageManager,
  OpenClawPreferredCommand,
  OpenClawPreferredCommandKind,
  OpenClawRepositoryRoot,
  OpenClawRepositorySnapshot,
  OpenClawRepositoryStyle,
} from "@shared/openclawRepositorySnapshot";

const MAX_SNAPSHOT_CACHE = 200;
const MANIFEST_CANDIDATE_DIRS = ["apps", "packages", "services", "client", "server"];

type PackageManifest = {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function safeExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function normalizeRelativePath(repositoryRoot: string, targetPath: string): string {
  const relativePath = path.relative(repositoryRoot, targetPath).replace(/\\/g, "/");
  return relativePath.length > 0 ? relativePath : ".";
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function toSortedArray(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function resolveGitValue(repositoryRoot: string, args: string[]): string | undefined {
  try {
    const value = execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function detectPackageManager(repositoryRoot: string): OpenClawPackageManager {
  if (safeExists(path.join(repositoryRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (safeExists(path.join(repositoryRoot, "bun.lockb")) || safeExists(path.join(repositoryRoot, "bun.lock"))) return "bun";
  if (safeExists(path.join(repositoryRoot, "yarn.lock"))) return "yarn";
  if (safeExists(path.join(repositoryRoot, "package-lock.json"))) return "npm";
  if (safeExists(path.join(repositoryRoot, "uv.lock"))) return "uv";
  if (
    safeExists(path.join(repositoryRoot, "requirements.txt")) ||
    safeExists(path.join(repositoryRoot, "pyproject.toml"))
  ) {
    return "pip";
  }
  return "unknown";
}

function detectRepositoryRoots(repositoryRoot: string): OpenClawRepositoryRoot[] {
  const roots: OpenClawRepositoryRoot[] = [];

  const registerRoot = (
    absoluteRoot: string,
    kind: OpenClawRepositoryRoot["kind"],
    manifest: OpenClawRepositoryRoot["manifest"],
    name?: string,
  ) => {
    const relativePath = normalizeRelativePath(repositoryRoot, absoluteRoot);
    if (roots.some((entry) => entry.path === relativePath)) return;
    roots.push({ path: relativePath, kind, manifest, name });
  };

  const rootPackage = readJsonFile<PackageManifest>(path.join(repositoryRoot, "package.json"));
  if (rootPackage) {
    registerRoot(repositoryRoot, "repository", "package.json", rootPackage.name);
  } else if (safeExists(path.join(repositoryRoot, "pyproject.toml"))) {
    registerRoot(repositoryRoot, "repository", "pyproject.toml");
  } else if (safeExists(path.join(repositoryRoot, "requirements.txt"))) {
    registerRoot(repositoryRoot, "repository", "requirements.txt");
  }

  for (const candidateDir of MANIFEST_CANDIDATE_DIRS) {
    const absoluteDir = path.join(repositoryRoot, candidateDir);
    if (!safeExists(absoluteDir)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryRoot = path.join(absoluteDir, entry.name);
      const packageManifest = readJsonFile<PackageManifest>(path.join(entryRoot, "package.json"));
      if (packageManifest) {
        registerRoot(
          entryRoot,
          candidateDir === "services" || candidateDir === "server" ? "service" : "application",
          "package.json",
          packageManifest.name || entry.name,
        );
        continue;
      }

      if (safeExists(path.join(entryRoot, "pyproject.toml"))) {
        registerRoot(
          entryRoot,
          candidateDir === "services" || candidateDir === "server" ? "service" : "application",
          "pyproject.toml",
          entry.name,
        );
        continue;
      }

      if (safeExists(path.join(entryRoot, "requirements.txt"))) {
        registerRoot(
          entryRoot,
          candidateDir === "services" || candidateDir === "server" ? "service" : "application",
          "requirements.txt",
          entry.name,
        );
      }
    }
  }

  return roots.sort((left, right) => left.path.localeCompare(right.path));
}

function detectSelectedRoot(
  repositoryRoot: string,
  selectedFolder: string,
  roots: OpenClawRepositoryRoot[],
): string | undefined {
  const selectedAbsolute = path.resolve(repositoryRoot, selectedFolder || ".");
  const candidates = roots
    .map((root) => ({
      path: root.path,
      absolutePath: path.resolve(repositoryRoot, root.path),
    }))
    .filter(
      (root) =>
        selectedAbsolute === root.absolutePath ||
        selectedAbsolute.startsWith(`${root.absolutePath}${path.sep}`),
    )
    .sort((left, right) => right.absolutePath.length - left.absolutePath.length);

  return candidates[0]?.path;
}

function collectStackSignals(
  repositoryRoot: string,
  roots: OpenClawRepositoryRoot[],
): { stacks: string[]; hasNode: boolean; hasPython: boolean; hasWorkspaces: boolean } {
  const stacks = new Set<string>();
  let hasNode = false;
  let hasPython = false;
  let hasWorkspaces = false;

  if (safeExists(path.join(repositoryRoot, "turbo.json"))) {
    stacks.add("Turbo");
    hasWorkspaces = true;
  }

  const rootPackage = readJsonFile<PackageManifest>(path.join(repositoryRoot, "package.json"));
  const packageManifests = [rootPackage, ...roots
    .filter((root) => root.manifest === "package.json" && root.path !== ".")
    .map((root) => readJsonFile<PackageManifest>(path.join(repositoryRoot, root.path, "package.json")))]
    .filter((manifest): manifest is PackageManifest => Boolean(manifest));

  for (const manifest of packageManifests) {
    hasNode = true;
    const deps = {
      ...(manifest.dependencies || {}),
      ...(manifest.devDependencies || {}),
    };
    const depNames = Object.keys(deps);

    if (depNames.includes("next")) stacks.add("Next.js");
    if (depNames.includes("react")) stacks.add("React");
    if (depNames.includes("vite")) stacks.add("Vite");
    if (depNames.includes("express")) stacks.add("Express");
    if (depNames.includes("electron")) stacks.add("Electron");
    if (depNames.includes("vitest")) stacks.add("Vitest");
    if (depNames.includes("playwright") || depNames.includes("@playwright/test")) {
      stacks.add("Playwright");
    }
    if (depNames.includes("drizzle-orm")) stacks.add("Drizzle");
    if (depNames.includes("typescript")) stacks.add("TypeScript");
    if (depNames.includes("tailwindcss")) stacks.add("Tailwind");
    if (
      Array.isArray(manifest.workspaces) ||
      (manifest.workspaces && Array.isArray(manifest.workspaces.packages))
    ) {
      hasWorkspaces = true;
    }
  }

  if (safeExists(path.join(repositoryRoot, "tsconfig.json"))) {
    stacks.add("TypeScript");
  }

  const pyprojectContents = readTextFile(path.join(repositoryRoot, "pyproject.toml"));
  const requirementsContents = readTextFile(path.join(repositoryRoot, "requirements.txt"));
  const pythonSignals = `${pyprojectContents}\n${requirementsContents}`.trim().toLowerCase();
  if (pythonSignals.length > 0 || roots.some((root) => root.manifest !== "package.json")) {
    hasPython = pythonSignals.length > 0 || roots.some((root) => root.manifest !== "package.json");
    if (/fastapi/.test(pythonSignals)) stacks.add("FastAPI");
    if (/django/.test(pythonSignals)) stacks.add("Django");
    if (/flask/.test(pythonSignals)) stacks.add("Flask");
    if (/pytest/.test(pythonSignals)) stacks.add("Pytest");
    if (/uvicorn/.test(pythonSignals)) stacks.add("Uvicorn");
    stacks.add("Python");
  }

  return {
    stacks: toSortedArray(stacks),
    hasNode,
    hasPython,
    hasWorkspaces,
  };
}

function detectRepositoryStyle(
  roots: OpenClawRepositoryRoot[],
  hasNode: boolean,
  hasPython: boolean,
  hasWorkspaces: boolean,
): OpenClawRepositoryStyle {
  if (hasNode && hasPython) return "polyglot";
  if (hasWorkspaces || roots.length > 2) return "monorepo";
  if (roots.length > 0) return "single-package";
  return "unknown";
}

function buildNodeCommand(
  packageManager: OpenClawPackageManager,
  scriptName: string,
): string {
  if (packageManager === "pnpm") return `pnpm run ${scriptName}`;
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function resolvePreferredCommands(
  repositoryRoot: string,
  selectedRoot: string | undefined,
  packageManager: OpenClawPackageManager,
): Partial<Record<OpenClawPreferredCommandKind, OpenClawPreferredCommand>> {
  const commands: Partial<Record<OpenClawPreferredCommandKind, OpenClawPreferredCommand>> = {};
  const rootsToInspect = [selectedRoot || ".", "."];

  const registerFromManifest = (
    rootPath: string,
    source: OpenClawPreferredCommand["source"],
  ) => {
    const manifest = readJsonFile<PackageManifest>(
      path.join(repositoryRoot, rootPath, "package.json"),
    );
    if (!manifest?.scripts) return;

    (["dev", "build", "test", "lint"] as OpenClawPreferredCommandKind[]).forEach((kind) => {
      if (commands[kind] || !manifest.scripts?.[kind]) return;
      commands[kind] = {
        command: buildNodeCommand(packageManager, kind),
        workingDirectory: rootPath,
        source,
      };
    });
  };

  for (const [index, rootPath] of rootsToInspect.entries()) {
    registerFromManifest(rootPath, index === 0 && selectedRoot ? "selected-root" : "repository-root");
  }

  const pyprojectContents = readTextFile(path.join(repositoryRoot, "pyproject.toml")).toLowerCase();
  const requirementsContents = readTextFile(path.join(repositoryRoot, "requirements.txt")).toLowerCase();
  const pythonContents = `${pyprojectContents}\n${requirementsContents}`;

  if (!commands.test && /pytest/.test(pythonContents)) {
    commands.test = {
      command: "pytest",
      workingDirectory: ".",
      source: "heuristic",
    };
  }
  if (!commands.lint && /ruff/.test(pyprojectContents)) {
    commands.lint = {
      command: "ruff check .",
      workingDirectory: ".",
      source: "heuristic",
    };
  }
  if (!commands.dev && /uvicorn/.test(pythonContents)) {
    commands.dev = {
      command: "uvicorn main:app --reload",
      workingDirectory: ".",
      source: "heuristic",
    };
  }
  if (!commands.build && /python/.test(pythonContents)) {
    commands.build = {
      command: "python -m compileall .",
      workingDirectory: ".",
      source: "heuristic",
    };
  }

  return commands;
}

function detectWorkflows(repositoryRoot: string): {
  ciWorkflows: string[];
  deployWorkflows: string[];
} {
  const workflowRoot = path.join(repositoryRoot, ".github", "workflows");
  if (!safeExists(workflowRoot)) {
    return { ciWorkflows: [], deployWorkflows: [] };
  }

  let workflowEntries: fs.Dirent[] = [];
  try {
    workflowEntries = fs.readdirSync(workflowRoot, { withFileTypes: true });
  } catch {
    return { ciWorkflows: [], deployWorkflows: [] };
  }

  const ciWorkflows: string[] = [];
  const deployWorkflows: string[] = [];

  for (const entry of workflowEntries) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/i.test(entry.name)) continue;

    const relativePath = `.github/workflows/${entry.name}`;
    ciWorkflows.push(relativePath);

    if (/(deploy|release|production|render|vercel|netlify|publish)/i.test(entry.name)) {
      deployWorkflows.push(relativePath);
    }
  }

  return {
    ciWorkflows: ciWorkflows.sort((left, right) => left.localeCompare(right)),
    deployWorkflows: deployWorkflows.sort((left, right) => left.localeCompare(right)),
  };
}

function detectSensitivePaths(repositoryRoot: string): string[] {
  const candidates = [
    ".env",
    ".env.production",
    ".github/workflows",
    "render.yaml",
    "vercel.json",
    "docker-compose.yml",
    "docker-compose.yaml",
    "desktop",
    "native",
    "server/openclaw",
    "drizzle",
    "migrations",
  ];

  return candidates
    .filter((candidate) => safeExists(path.join(repositoryRoot, candidate)))
    .sort((left, right) => left.localeCompare(right));
}

function detectOpenClawSignals(repositoryRoot: string): string[] {
  const signals = new Set<string>();

  if (safeExists(path.join(repositoryRoot, "server", "openclaw"))) {
    signals.add("server/openclaw");
  }

  const rootPackage = readJsonFile<PackageManifest>(path.join(repositoryRoot, "package.json"));
  if (rootPackage) {
    const raw = JSON.stringify(rootPackage).toLowerCase();
    if (raw.includes("openclaw")) {
      signals.add("package.json:openclaw");
    }
    if (raw.includes("verify:openclaw")) {
      signals.add("scripts:verify-openclaw");
    }
  }

  if (safeExists(path.join(repositoryRoot, "tests", "unit", "openclaw-native-parity.test.ts"))) {
    signals.add("tests/openclaw-native-parity");
  }

  return toSortedArray(signals);
}

class RepositorySnapshotService {
  private readonly cache = new Map<string, OpenClawRepositorySnapshot>();

  capture(workspaceContext: OpenClawWorkspaceContext): OpenClawRepositorySnapshot {
    const requestedRepositoryPath = path.resolve(workspaceContext.repositoryPath);
    const resolvedRepositoryPath = safeExists(requestedRepositoryPath)
      ? fs.realpathSync(requestedRepositoryPath)
      : requestedRepositoryPath;
    const repositoryExists =
      safeExists(resolvedRepositoryPath) &&
      fs.statSync(resolvedRepositoryPath).isDirectory();

    const headSha = repositoryExists
      ? resolveGitValue(resolvedRepositoryPath, ["rev-parse", "HEAD"])
      : undefined;
    const branch =
      workspaceContext.branch ||
      (repositoryExists
        ? resolveGitValue(resolvedRepositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"])
        : undefined);
    const cacheKey = [
      resolvedRepositoryPath,
      branch || "",
      headSha || "",
      workspaceContext.selectedFolder || ".",
    ].join("::");
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const packageManager = repositoryExists
      ? detectPackageManager(resolvedRepositoryPath)
      : "unknown";
    const roots = repositoryExists
      ? detectRepositoryRoots(resolvedRepositoryPath)
      : [];
    const selectedRoot = repositoryExists
      ? detectSelectedRoot(
          resolvedRepositoryPath,
          workspaceContext.selectedFolder,
          roots,
        )
      : undefined;
    const stackSignals = repositoryExists
      ? collectStackSignals(resolvedRepositoryPath, roots)
      : { stacks: [], hasNode: false, hasPython: false, hasWorkspaces: false };
    const workflows = repositoryExists
      ? detectWorkflows(resolvedRepositoryPath)
      : { ciWorkflows: [], deployWorkflows: [] };

    const snapshot: OpenClawRepositorySnapshot = {
      generatedAt: new Date().toISOString(),
      repositoryPath: workspaceContext.repositoryPath,
      resolvedRepositoryPath,
      repositoryExists,
      branch,
      headSha,
      repoStyle: detectRepositoryStyle(
        roots,
        stackSignals.hasNode,
        stackSignals.hasPython,
        stackSignals.hasWorkspaces,
      ),
      packageManager,
      stacks: stackSignals.stacks,
      roots,
      selectedRoot,
      preferredCommands: repositoryExists
        ? resolvePreferredCommands(
            resolvedRepositoryPath,
            selectedRoot,
            packageManager,
          )
        : {},
      ciWorkflows: workflows.ciWorkflows,
      deployWorkflows: workflows.deployWorkflows,
      sensitivePaths: repositoryExists
        ? detectSensitivePaths(resolvedRepositoryPath)
        : [],
      openClawSignals: repositoryExists
        ? detectOpenClawSignals(resolvedRepositoryPath)
        : [],
    };

    this.cache.set(cacheKey, snapshot);
    this.trim();
    return snapshot;
  }

  clear(): void {
    this.cache.clear();
  }

  private trim(): void {
    if (this.cache.size <= MAX_SNAPSHOT_CACHE) return;
    const overflow = this.cache.size - MAX_SNAPSHOT_CACHE;
    const keys = Array.from(this.cache.keys());
    for (let index = 0; index < overflow; index += 1) {
      this.cache.delete(keys[index]);
    }
  }
}

export const repositorySnapshotService = new RepositorySnapshotService();

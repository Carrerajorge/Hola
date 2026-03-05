import fs from "fs-extra";
import os from "os";
import path from "path";

const DENYLIST_SEGMENTS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gcloud",
  ".config/gh",
  ".kube",
  ".npmrc",
  ".env",
  "id_rsa",
  "id_ed25519",
  "credentials",
];

function normalize(value: string): string {
  return value.replace(/\\/g, "/");
}

export async function validateWorkspaceRoot(workspaceInput: string): Promise<string> {
  if (!workspaceInput || !workspaceInput.trim()) {
    throw new Error("Workspace is required");
  }
  const expanded = expandHome(workspaceInput.trim());
  const resolved = path.resolve(expanded);
  const exists = await fs.pathExists(resolved);
  if (!exists) {
    throw new Error(`Workspace does not exist: ${resolved}`);
  }
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${resolved}`);
  }
  const real = await fs.realpath(resolved);
  if (isSensitive(real)) {
    throw new Error("Workspace cannot be a sensitive directory");
  }
  return real;
}

export async function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  if (!requestedPath || !requestedPath.trim()) {
    throw new Error("Path is required");
  }

  const expanded = expandHome(requestedPath.trim());
  const lexical = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot, expanded);

  if (!isWithinRoot(workspaceRoot, lexical)) {
    throw new Error("Access denied: path is outside of workspace");
  }

  if (isSensitive(lexical)) {
    throw new Error("Access denied: sensitive path is blocked");
  }

  await assertNoSymlinkTraversal(workspaceRoot, lexical);

  return lexical;
}

export function sanitizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

export function isCommandAllowed(command: string, allowlist: string[]): boolean {
  const normalized = sanitizeCommand(command);
  if (!normalized) {
    return false;
  }
  return allowlist.some((allowed) => {
    const rule = sanitizeCommand(allowed);
    if (!rule) {
      return false;
    }
    return normalized === rule || normalized.startsWith(`${rule} `);
  });
}

export function isCommandDangerous(command: string, dangerousList: string[]): boolean {
  const normalized = sanitizeCommand(command);
  if (!normalized) {
    return false;
  }
  const firstToken = normalized.split(" ")[0];
  return dangerousList.some((entry) => {
    const rule = sanitizeCommand(entry);
    return rule === firstToken || normalized.startsWith(`${rule} `);
  });
}

export function createSafeEnv(workspaceRoot: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: os.homedir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: process.env.TERM ?? "xterm",
    PWD: workspaceRoot,
    NODE_ENV: "production",
  };
}

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (!relative) {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSensitive(absolutePath: string): boolean {
  const normalized = normalize(absolutePath);
  const homeNormalized = normalize(os.homedir());
  if (!normalized.startsWith(homeNormalized)) {
    return false;
  }

  const rel = normalized.slice(homeNormalized.length).replace(/^\//, "");
  return DENYLIST_SEGMENTS.some((segment) => {
    const s = normalize(segment).replace(/^\//, "");
    return rel === s || rel.startsWith(`${s}/`) || rel.includes(`/${s}/`);
  });
}

async function assertNoSymlinkTraversal(root: string, target: string): Promise<void> {
  const rel = path.relative(root, target);
  if (!rel) {
    return;
  }

  let current = root;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    if (!(await fs.pathExists(current))) {
      continue;
    }
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error("Access denied: symlink traversal is blocked");
    }
  }
}

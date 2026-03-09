import { Router } from "express";
import fs from "fs/promises";
import { createReadStream } from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { execFile } from "child_process";
import { executeLocalControlRequest } from "./chatAiRouter";

const router = Router();

const LOCAL_ALLOWED_ROOTS = Array.from(
  new Set([path.resolve(os.homedir()), path.resolve(process.cwd())])
);
const LOCAL_DOWNLOAD_ALLOWED_ROOTS = Array.from(
  new Set([
    ...LOCAL_ALLOWED_ROOTS,
    path.resolve(os.tmpdir()),
    path.resolve(`/private${os.tmpdir()}`),
  ]),
);

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function inferMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt" || ext === ".md") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function inferArtifactTypeFromMime(mimeType: string): "image" | "document" | "spreadsheet" | "presentation" | "pdf" {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized === "application/pdf") return "pdf";
  if (normalized.includes("spreadsheet") || normalized.includes("excel") || normalized.includes("csv")) return "spreadsheet";
  if (normalized.includes("presentation") || normalized.includes("powerpoint")) return "presentation";
  return "document";
}

function buildLocalFileDownloadUrl(filePath: string): string {
  return `/api/local/file?path=${encodeURIComponent(filePath)}`;
}

function buildLocalExecArtifact(payload?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const localPath = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!localPath) return undefined;

  const mimeTypeRaw = typeof payload.mimeType === "string" ? payload.mimeType.trim() : "";
  const mimeType = mimeTypeRaw || inferMimeTypeFromPath(localPath);
  const fileNameRaw = typeof payload.fileName === "string" ? payload.fileName.trim() : "";
  const fileName = fileNameRaw || path.basename(localPath);
  const artifactType = inferArtifactTypeFromMime(mimeType);
  const downloadUrl = buildLocalFileDownloadUrl(localPath);

  return {
    artifactId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    type: artifactType,
    mimeType,
    sizeBytes: typeof payload.bytes === "number" && Number.isFinite(payload.bytes) ? payload.bytes : undefined,
    downloadUrl,
    previewUrl: artifactType === "image" ? downloadUrl : undefined,
    filename: fileName,
    name: fileName,
    path: localPath,
    localControl: true,
  };
}

async function resolveRepositoryRoot(inputPath: string): Promise<string> {
  const raw = String(inputPath || "").trim();
  if (!raw) {
    throw new Error("Repository path is required");
  }

  const resolved = path.resolve(expandHome(raw));
  const allowed = LOCAL_ALLOWED_ROOTS.some((root) => isPathInside(root, resolved));
  if (!allowed) {
    throw new Error(`Repository path must be inside: ${LOCAL_ALLOWED_ROOTS.join(", ")}`);
  }

  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error("Repository path does not exist or is not a directory");
  }

  return resolved;
}

function sanitizeRelativeFolderPath(inputPath: string): string {
  const raw = String(inputPath || "").trim().replace(/\\/g, "/");
  if (!raw) throw new Error("Folder path is required");
  if (raw.startsWith("/")) throw new Error("Folder path must be relative");
  if (raw.includes("..")) throw new Error("Folder path cannot include '..'");
  return raw.replace(/^\.\/+/, "");
}

function sanitizeRepositoryRelativePath(inputPath: string, allowDot = false): string {
  const raw = String(inputPath || "").trim().replace(/\\/g, "/");
  if (!raw || raw === ".") {
    if (allowDot) return ".";
    throw new Error("Path is required");
  }
  if (raw.startsWith("/")) throw new Error("Path must be relative");
  if (raw.includes("..")) throw new Error("Path cannot include '..'");
  return raw.replace(/^\.\/+/, "");
}

function resolveRepositoryPath(rootPath: string, relativePath: string): string {
  const safeRelativePath = sanitizeRepositoryRelativePath(relativePath, true);
  const resolvedPath = safeRelativePath === "."
    ? rootPath
    : path.resolve(rootPath, safeRelativePath);
  if (!isPathInside(rootPath, resolvedPath)) {
    throw new Error("Path escapes repository root");
  }
  return resolvedPath;
}

function shouldSkipRepositoryEntry(entryName: string, includeHidden: boolean): boolean {
  if (!includeHidden && entryName.startsWith(".")) return true;
  return ["node_modules", ".git", "dist", "build", ".next", "coverage"].includes(entryName);
}

function isProbablyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let suspiciousBytes = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    if (byte === 0) return false;
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes += 1;
    }
  }
  return suspiciousBytes / sample.length < 0.1;
}

type RepositoryTreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: RepositoryTreeNode[];
};

async function collectRepositoryTree(
  rootPath: string,
  folderPath: string,
  maxDepth: number,
  maxEntries: number,
  includeHidden: boolean,
): Promise<{ nodes: RepositoryTreeNode[]; count: number; truncated: boolean }> {
  const startPath = resolveRepositoryPath(rootPath, folderPath);
  const state = { remaining: maxEntries, truncated: false };

  const walk = async (absolutePath: string, relativePath: string, depth: number): Promise<RepositoryTreeNode[]> => {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
    const sortedEntries = entries
      .filter((entry) => !shouldSkipRepositoryEntry(entry.name, includeHidden))
      .sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) return -1;
        if (!left.isDirectory() && right.isDirectory()) return 1;
        return left.name.localeCompare(right.name);
      });

    const nodes: RepositoryTreeNode[] = [];
    for (const entry of sortedEntries) {
      if (state.remaining <= 0) {
        state.truncated = true;
        break;
      }

      const nextRelativePath = relativePath === "."
        ? entry.name
        : `${relativePath}/${entry.name}`;

      state.remaining -= 1;

      const node: RepositoryTreeNode = {
        name: entry.name,
        path: nextRelativePath,
        type: entry.isDirectory() ? "directory" : "file",
      };

      if (entry.isDirectory() && depth + 1 < maxDepth) {
        const childAbsolutePath = path.join(absolutePath, entry.name);
        node.children = await walk(childAbsolutePath, nextRelativePath, depth + 1);
      }

      nodes.push(node);
    }

    return nodes;
  };

  const normalizedFolderPath = folderPath === "." ? "." : sanitizeRepositoryRelativePath(folderPath, true);
  const nodes = await walk(startPath, normalizedFolderPath, 0);
  return {
    nodes,
    count: maxEntries - state.remaining,
    truncated: state.truncated,
  };
}

type RepositoryCommandResult = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

async function executeRepositoryCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<RepositoryCommandResult> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-lc", command],
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1_000_000,
      },
      (error, stdout, stderr) => {
        const execError = error as (NodeJS.ErrnoException & {
          code?: number | string;
          signal?: string;
          killed?: boolean;
        }) | null;
        const message = String(execError?.message || "");
        const timedOut = Boolean(execError?.killed && /timed out/i.test(message));
        const truncated = message.includes("maxBuffer");
        const exitCode = typeof execError?.code === "number"
          ? execError.code
          : timedOut
            ? 124
            : execError
              ? 1
              : 0;

        resolve({
          command,
          cwd,
          exitCode,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          timedOut,
          truncated,
        });
      },
    );
  });
}

async function collectRepositoryFolders(rootPath: string, maxDepth: number, maxEntries: number, includeHidden: boolean): Promise<string[]> {
  const folders: string[] = [];
  const queue: Array<{ absPath: string; depth: number; relativePath: string }> = [
    { absPath: rootPath, depth: 0, relativePath: "." },
  ];

  while (queue.length > 0 && folders.length < maxEntries) {
    const current = queue.shift();
    if (!current) break;

    const entries = await fs.readdir(current.absPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;

      const absoluteEntry = path.join(current.absPath, entry.name);
      const relativeEntry = current.relativePath === "."
        ? entry.name
        : `${current.relativePath}/${entry.name}`;

      folders.push(relativeEntry);
      if (folders.length >= maxEntries) break;

      if (current.depth + 1 < maxDepth) {
        queue.push({
          absPath: absoluteEntry,
          depth: current.depth + 1,
          relativePath: relativeEntry,
        });
      }
    }
  }

  return folders.sort((a, b) => a.localeCompare(b));
}

function extractFolderName(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const patterns = [
    /(?:crea|crear|creame|haz|genera)\s+(?:una\s+)?(?:carpeta|caroeta|carepta)(?:\s+en\s+mi\s+(?:escritorio|excritorio))?(?:\s+(?:llamada|con\s+nombre))?\s+["']?([^"'\n]{1,120})["']?/i,
    /^(?:\/)?mkdir\s+["']?([^"'\n]{1,120})["']?$/i,
  ];

  for (const re of patterns) {
    const m = prompt.match(re);
    const candidate = m?.[1]?.trim().replace(/[.,;:!?]+$/g, "").trim();
    if (candidate) return candidate;
  }
  return null;
}

router.post("/local/create-folder", async (req, res) => {
  try {
    const bodyName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const bodyPrompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const name = bodyName || extractFolderName(bodyPrompt);

    if (!name) {
      return res.status(400).json({ success: false, error: "Folder name is required" });
    }

    const invalid = /[\\/:*?"<>|]/.test(name) || name.includes("..");
    if (invalid) {
      return res.status(400).json({ success: false, error: "Invalid folder name" });
    }

    const folderPath = path.join(os.homedir(), "Desktop", name);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.appendFile(
      path.join(os.homedir(), ".iliagpt-control-audit.log"),
      `${new Date().toISOString()} local_control_router mkdir path=${folderPath}\n`,
      "utf-8"
    );

    return res.json({
      success: true,
      name,
      path: folderPath,
      message: `Listo. Carpeta creada en tu escritorio: ${folderPath}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "Failed to create folder" });
  }
});

router.get("/local/repo/folders", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.query.rootPath || ""));
    const requestedDepth = Number(req.query.maxDepth ?? 3);
    const maxDepth = Number.isFinite(requestedDepth) ? Math.min(Math.max(Math.trunc(requestedDepth), 1), 5) : 3;
    const requestedEntries = Number(req.query.maxEntries ?? 400);
    const maxEntries = Number.isFinite(requestedEntries) ? Math.min(Math.max(Math.trunc(requestedEntries), 20), 2000) : 400;
    const includeHidden = String(req.query.includeHidden || "false").toLowerCase() === "true";

    const folders = await collectRepositoryFolders(rootPath, maxDepth, maxEntries, includeHidden);
    return res.json({
      success: true,
      rootPath,
      folders,
      count: folders.length,
      maxDepth,
      maxEntries,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to list repository folders" });
  }
});

router.post("/local/repo/folders", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.body?.rootPath || ""));
    const folderPath = sanitizeRelativeFolderPath(String(req.body?.folderPath || ""));
    const targetPath = path.resolve(rootPath, folderPath);
    if (!isPathInside(rootPath, targetPath)) {
      return res.status(400).json({ success: false, error: "Folder path escapes repository root" });
    }

    await fs.mkdir(targetPath, { recursive: true });
    return res.json({
      success: true,
      rootPath,
      folderPath,
      absolutePath: targetPath,
      message: `Folder created: ${folderPath}`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to create repository folder" });
  }
});

router.get("/local/repo/branches", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.query.rootPath || ""));
    const gitDir = path.join(rootPath, ".git");
    const gitStat = await fs.stat(gitDir).catch(() => null);
    if (!gitStat || !gitStat.isDirectory()) {
      return res.json({ success: true, rootPath, branches: [], current: null, isGitRepo: false });
    }

    const branchesOutput = await new Promise<string>((resolve, reject) => {
      execFile("git", ["branch", "--format", "%(refname:short)"], { cwd: rootPath }, (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout || "");
      });
    });

    const currentBranch = await new Promise<string>((resolve, reject) => {
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootPath }, (error, stdout) => {
        if (error) return reject(error);
        resolve((stdout || "").trim());
      });
    });

    const branches = branchesOutput
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    return res.json({
      success: true,
      rootPath,
      branches,
      current: currentBranch || null,
      isGitRepo: true,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to read repository branches" });
  }
});

router.get("/local/repo/tree", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.query.rootPath || ""));
    const folderPath = String(req.query.folderPath || ".").trim() || ".";
    const requestedDepth = Number(req.query.maxDepth ?? 4);
    const maxDepth = Number.isFinite(requestedDepth)
      ? Math.min(Math.max(Math.trunc(requestedDepth), 1), 8)
      : 4;
    const requestedEntries = Number(req.query.maxEntries ?? 1200);
    const maxEntries = Number.isFinite(requestedEntries)
      ? Math.min(Math.max(Math.trunc(requestedEntries), 50), 5000)
      : 1200;
    const includeHidden = String(req.query.includeHidden || "false").toLowerCase() === "true";

    const tree = await collectRepositoryTree(rootPath, folderPath, maxDepth, maxEntries, includeHidden);
    return res.json({
      success: true,
      rootPath,
      folderPath: folderPath === "." ? "." : sanitizeRepositoryRelativePath(folderPath, true),
      maxDepth,
      maxEntries,
      count: tree.count,
      truncated: tree.truncated,
      nodes: tree.nodes,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to inspect repository tree" });
  }
});

router.get("/local/repo/file", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.query.rootPath || ""));
    const filePath = sanitizeRepositoryRelativePath(String(req.query.filePath || ""));
    const absolutePath = resolveRepositoryPath(rootPath, filePath);
    const stat = await fs.stat(absolutePath).catch(() => null);

    if (!stat) {
      return res.status(404).json({ success: false, error: "File not found" });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ success: false, error: "Path is not a file" });
    }
    if (stat.size > 750_000) {
      return res.status(413).json({
        success: false,
        error: "File too large to edit in browser",
        size: stat.size,
      });
    }

    const buffer = await fs.readFile(absolutePath);
    if (!isProbablyTextBuffer(buffer)) {
      return res.status(415).json({
        success: false,
        error: "Binary files are not supported in the editor",
        size: stat.size,
      });
    }

    return res.json({
      success: true,
      rootPath,
      filePath,
      absolutePath,
      content: buffer.toString("utf-8"),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to read repository file" });
  }
});

router.put("/local/repo/file", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.body?.rootPath || ""));
    const filePath = sanitizeRepositoryRelativePath(String(req.body?.filePath || ""));
    const content = typeof req.body?.content === "string" ? req.body.content : null;
    if (content === null) {
      return res.status(400).json({ success: false, error: "Content must be a string" });
    }
    if (content.length > 2_000_000) {
      return res.status(413).json({ success: false, error: "Content too large to save" });
    }

    const absolutePath = resolveRepositoryPath(rootPath, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");
    const stat = await fs.stat(absolutePath);

    return res.json({
      success: true,
      rootPath,
      filePath,
      absolutePath,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to save repository file" });
  }
});

router.post("/local/repo/command", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.body?.rootPath || ""));
    const cwdRelative = String(req.body?.cwd || ".").trim() || ".";
    const absoluteCwd = resolveRepositoryPath(rootPath, cwdRelative);
    const stat = await fs.stat(absoluteCwd).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(400).json({ success: false, error: "cwd must resolve to a directory" });
    }

    const command = String(req.body?.command || "").trim();
    if (!command) {
      return res.status(400).json({ success: false, error: "Command is required" });
    }

    const requestedTimeout = Number(req.body?.timeoutMs ?? 20_000);
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.min(Math.max(Math.trunc(requestedTimeout), 1_000), 120_000)
      : 20_000;

    const result = await executeRepositoryCommand(command, absoluteCwd, timeoutMs);
    return res.json({
      success: true,
      ok: result.exitCode === 0 && !result.timedOut,
      rootPath,
      ...result,
      cwd: path.relative(rootPath, absoluteCwd) || ".",
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to execute repository command" });
  }
});

/**
 * General-purpose local control endpoint.
 * Accepts either:
 *   { command: "shell", args: ["ls -la"] }           — structured form
 *   { prompt: "ejecuta el comando ls -la" }           — natural language
 *   { prompt: "/local shell ls -la" }                 — prefixed form
 *
 * The frontend uses this to execute ANY local command (rm, read, write, shell, ls, cp, etc.)
 * without going through the LLM stream.
 */
router.post("/local/exec", async (req, res) => {
  try {
    const body = req.body || {};
    let inputText = "";

    // Option 1: Structured command + args
    if (typeof body.command === "string" && body.command.trim()) {
      const cmd = body.command.trim().toLowerCase();
      const argsArr = Array.isArray(body.args) ? body.args : [];
      const argsStr = argsArr.map((a: any) => String(a)).join(" ");
      const confirmFlag = body.confirm ? " confirmar" : "";
      inputText = `/local ${cmd} ${argsStr}${confirmFlag}`.trim();
    }
    // Option 2: Raw prompt (natural language or prefixed)
    else if (typeof body.prompt === "string" && body.prompt.trim()) {
      inputText = body.prompt.trim();
    }

    if (!inputText) {
      return res.status(400).json({
        success: false,
        error: "Se requiere 'command' o 'prompt'.",
        usage: {
          structured: { command: "shell", args: ["ls -la ~/Desktop"] },
          natural: { prompt: "ejecuta el comando ls -la" },
          prefixed: { prompt: "/local shell ls -la" },
        },
      });
    }

    const requestId = `local_exec_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
    const userId = (req as any).userId || (req as any).session?.userId || "anonymous";

    const result = await executeLocalControlRequest(inputText, { requestId, userId });

    if (!result.handled) {
      return res.status(400).json({
        success: false,
        error: "No se detecto un comando local valido en el input.",
        input: inputText,
      });
    }

    const artifact = buildLocalExecArtifact(result.payload);

    return res.status(result.statusCode).json({
      success: result.ok,
      code: result.code,
      message: result.message,
      payload: result.payload || {},
      artifact: artifact || null,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Error al ejecutar comando local.",
    });
  }
});

router.get("/local/file", async (req, res) => {
  try {
    const rawPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!rawPath) {
      return res.status(400).json({ success: false, error: "File path is required" });
    }

    const resolvedPath = path.resolve(expandHome(rawPath));
    const realPath = await fs.realpath(resolvedPath).catch(() => resolvedPath);
    const allowed = LOCAL_DOWNLOAD_ALLOWED_ROOTS.some((root) =>
      isPathInside(root, resolvedPath) || isPathInside(root, realPath)
    );
    if (!allowed) {
      return res.status(403).json({ success: false, error: "Path is outside allowed local roots" });
    }

    const stat = await fs.stat(realPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    const mimeType = inferMimeTypeFromPath(realPath);
    const fileName = path.basename(realPath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);

    const stream = createReadStream(realPath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Failed to stream local file" });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to serve local file",
    });
  }
});

export function createLocalControlRouter() {
  return router;
}

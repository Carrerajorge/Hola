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

function runGitCommand(rootPath: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile("git", args, { cwd: rootPath }, (error, stdout, stderr) => {
      if (error) {
        const enriched = new Error((stderr || stdout || error.message || "Git command failed").trim());
        (enriched as Error & { cause?: unknown }).cause = error;
        return reject(enriched);
      }
      resolve(String(stdout || ""));
    });
  });
}

async function ensureGitRepository(rootPath: string): Promise<void> {
  const insideWorkTree = await runGitCommand(rootPath, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.trim() !== "true") {
    throw new Error("The selected path is not a git repository");
  }
}

function parseGitNumstat(rawOutput: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;

  for (const line of String(rawOutput || "").split("\n")) {
    const [addedRaw, deletedRaw] = line.trim().split("\t");
    const added = Number(addedRaw);
    const deleted = Number(deletedRaw);
    if (Number.isFinite(added)) insertions += added;
    if (Number.isFinite(deleted)) deletions += deleted;
  }

  return { insertions, deletions };
}

async function readWorkingTreeSummary(rootPath: string): Promise<{
  modifiedFiles: number;
  insertions: number;
  deletions: number;
  label: string;
}> {
  const statusOutput = await runGitCommand(rootPath, ["status", "--porcelain=v1"]);
  const unstagedDiff = await runGitCommand(rootPath, ["diff", "--numstat"]);
  const stagedDiff = await runGitCommand(rootPath, ["diff", "--cached", "--numstat"]);

  const modifiedFiles = statusOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  const unstagedStats = parseGitNumstat(unstagedDiff);
  const stagedStats = parseGitNumstat(stagedDiff);
  const insertions = unstagedStats.insertions + stagedStats.insertions;
  const deletions = unstagedStats.deletions + stagedStats.deletions;
  const formatNumber = (value: number) => new Intl.NumberFormat("es-BO").format(value);

  return {
    modifiedFiles,
    insertions,
    deletions,
    label:
      modifiedFiles > 0
        ? `Sin confirmar: ${formatNumber(modifiedFiles)} archivos +${formatNumber(insertions)} -${formatNumber(deletions)}`
        : "Sin cambios pendientes",
  };
}

function validateBranchName(input: string): string {
  const branch = String(input || "").trim();
  if (!branch) {
    throw new Error("Branch name is required");
  }
  if (
    branch.startsWith("-") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("\\") ||
    branch.includes(" ") ||
    branch.endsWith("/") ||
    branch.endsWith(".lock") ||
    branch.includes("//")
  ) {
    throw new Error("Branch name is invalid");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Branch name contains unsupported characters");
  }
  return branch;
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


router.get("/local/pick-folder", async (req, res) => {
  try {
    const { exec } = await import("child_process");
    exec('osascript -e \'choose folder with prompt "Selecciona una carpeta para modificar su código"\' -e \'POSIX path of result\'', (error, stdout) => {
      if (error) {
        return res.status(500).json({ success: false, error: "Carpeta no seleccionada o cancelado" });
      }
      const path = stdout.trim();
      return res.json({ success: true, path });
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Error al abrir seleccionador de carpetas" });
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
    try {
      await ensureGitRepository(rootPath);
    } catch {
      return res.json({ success: true, rootPath, branches: [], current: null, isGitRepo: false });
    }

    const branchesOutput = await runGitCommand(rootPath, ["branch", "--format", "%(refname:short)"]);
    const currentBranch = (await runGitCommand(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const summary = await readWorkingTreeSummary(rootPath);

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
      summary,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to read repository branches" });
  }
});

router.post("/local/repo/branches/switch", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.body?.rootPath || ""));
    const branch = validateBranchName(String(req.body?.branch || ""));

    await ensureGitRepository(rootPath);

    try {
      await runGitCommand(rootPath, ["switch", branch]);
    } catch {
      await runGitCommand(rootPath, ["checkout", branch]);
    }

    const branchesOutput = await runGitCommand(rootPath, ["branch", "--format", "%(refname:short)"]);
    const currentBranch = (await runGitCommand(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const summary = await readWorkingTreeSummary(rootPath);

    return res.json({
      success: true,
      rootPath,
      branch: currentBranch,
      current: currentBranch,
      branches: branchesOutput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      summary,
      message: `Switched to ${branch}`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to switch branch" });
  }
});

router.post("/local/repo/branches/create", async (req, res) => {
  try {
    const rootPath = await resolveRepositoryRoot(String(req.body?.rootPath || ""));
    const branch = validateBranchName(String(req.body?.branch || ""));
    const checkout = req.body?.checkout !== false;

    await ensureGitRepository(rootPath);

    if (checkout) {
      try {
        await runGitCommand(rootPath, ["switch", "-c", branch]);
      } catch {
        await runGitCommand(rootPath, ["checkout", "-b", branch]);
      }
    } else {
      await runGitCommand(rootPath, ["branch", branch]);
    }

    const branchesOutput = await runGitCommand(rootPath, ["branch", "--format", "%(refname:short)"]);
    const currentBranch = (await runGitCommand(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const summary = await readWorkingTreeSummary(rootPath);

    return res.json({
      success: true,
      rootPath,
      branch: checkout ? currentBranch : branch,
      current: currentBranch,
      branches: branchesOutput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      summary,
      message: checkout ? `Created and switched to ${branch}` : `Created ${branch}`,
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || "Failed to create branch" });
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
    res.setHeader("Content-Disposition", `inline; filename=\"${fileName.replace(/\"/g, "")}\"`);

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

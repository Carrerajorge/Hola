import { z } from "zod";
import type { ToolDefinition, ToolResult, ToolContext } from "./toolTypes";
import { createArtifact, createError } from "./toolTypes";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeResolveInsideCwd(userPath: string): { ok: true; absPath: string } | { ok: false; reason: string } {
  const cwd = process.cwd();
  const absPath = path.resolve(cwd, userPath);
  if (!absPath.startsWith(cwd)) {
    return { ok: false, reason: "Path outside project directory is not allowed" };
  }
  return { ok: true, absPath };
}

function icsEscape(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function icsDateUtc(date: Date): string {
  const iso = date.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseMoneyCandidates(input: string): Array<{ currency: string; value: number; raw: string }> {
  const text = String(input || "");
  const out: Array<{ currency: string; value: number; raw: string }> = [];

  // $ 1,234.56 | USD 1234.56 | 1.234,56 EUR | 1234 MXN
  const patterns = [
    /(\$|USD|US\$|EUR|€|GBP|£|MXN|ARS|COP|CLP|BRL)\s*([0-9][0-9.,\s]{0,20})/gi,
    /([0-9][0-9.,\s]{0,20})\s*(USD|EUR|€|GBP|£|MXN|ARS|COP|CLP|BRL)/gi,
  ];

  const normalizeNumber = (raw: string): number | null => {
    const s = raw.replace(/\s+/g, "");
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");
    let normalized = s;
    if (hasDot && hasComma) {
      // Use last separator as decimal separator
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      const dec = lastComma > lastDot ? "," : ".";
      const thousands = dec === "," ? "." : ",";
      normalized = normalized.replaceAll(thousands, "").replace(dec, ".");
    } else if (hasComma && !hasDot) {
      // If only comma, assume decimal when it looks like cents, otherwise thousands
      const parts = s.split(",");
      if (parts.length === 2 && parts[1].length <= 2) normalized = s.replace(",", ".");
      else normalized = s.replaceAll(",", "");
    } else {
      // Only dot or none: remove thousands commas already handled, keep dot as decimal
      normalized = s.replaceAll(",", "");
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  };

  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const a = (m[1] || "").trim();
      const b = (m[2] || "").trim();
      const currency = (a && /[A-Z€£$]/.test(a[0])) ? a : b;
      const numberRaw = currency === a ? b : a;
      const value = normalizeNumber(numberRaw);
      if (value === null) continue;
      out.push({ currency, value, raw: m[0] });
    }
  }

  return out;
}

async function getDiskSnapshot(): Promise<{ ok: true; disks: any[] } | { ok: false; reason: string }> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("wmic", ["logicaldisk", "get", "Caption,FreeSpace,Size", "/format:csv"], { timeout: 8000 });
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const disks: any[] = [];
      for (const line of lines) {
        if (line.toLowerCase().includes("caption") || line.toLowerCase().includes("node,")) continue;
        const parts = line.split(",").map((p) => p.trim());
        // CSV: Node,Caption,FreeSpace,Size
        if (parts.length < 4) continue;
        const caption = parts[1];
        const free = Number(parts[2] || 0);
        const size = Number(parts[3] || 0);
        if (!size) continue;
        const used = size - free;
        disks.push({
          drive: caption,
          sizeBytes: size,
          freeBytes: free,
          usedBytes: used,
          usedPct: size > 0 ? Math.round((used / size) * 1000) / 10 : null,
        });
      }
      return { ok: true, disks };
    }

    const { stdout } = await execFileAsync("df", ["-kP"], { timeout: 8000 });
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const disks: any[] = [];
    for (const line of lines.slice(1)) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const [filesystem, sizeKb, usedKb, availKb, capacity, mount] = parts;
      disks.push({
        filesystem,
        sizeKb: Number(sizeKb),
        usedKb: Number(usedKb),
        availableKb: Number(availKb),
        usedPct: Number(String(capacity || "").replace("%", "")) || null,
        mount,
      });
    }
    return { ok: true, disks };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Failed to read disk usage" };
  }
}

// ============================================================================
// 1) SYSTEM MONITOR (CPU/RAM/DISK)
// ============================================================================

const systemMonitorSchema = z.object({
  sampleMs: z.number().int().min(100).max(5000).default(500).describe("Sampling window (ms) to estimate CPU usage"),
  includeDisk: z.boolean().default(true).describe("Include disk usage snapshot"),
});

export const systemMonitorTool: ToolDefinition = {
  name: "system_monitor",
  description: "Monitor CPU, RAM, and disk usage in near real-time. Returns a snapshot of system metrics and basic anomaly-friendly percentages.",
  inputSchema: systemMonitorSchema,
  capabilities: [],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const sampleMs = clamp(Number(input.sampleMs ?? 500), 100, 5000);

      const readCpu = () => {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;
        for (const cpu of cpus) {
          const times = cpu.times;
          idle += times.idle;
          total += times.user + times.nice + times.sys + times.irq + times.idle;
        }
        return { idle, total, cores: cpus.length };
      };

      const t1 = readCpu();
      await sleep(sampleMs);
      const t2 = readCpu();
      const idleDelta = t2.idle - t1.idle;
      const totalDelta = t2.total - t1.total;
      const cpuUsedPct = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = Math.max(0, totalMem - freeMem);
      const memUsedPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;

      const disk = input.includeDisk ? await getDiskSnapshot() : { ok: true as const, disks: [] };

      return {
        success: true,
        output: {
          platform: process.platform,
          hostname: os.hostname(),
          uptimeSec: os.uptime(),
          cpu: {
            cores: t2.cores,
            usedPct: Math.round(cpuUsedPct * 10) / 10,
            loadAvg: process.platform === "win32" ? null : os.loadavg(),
          },
          memory: {
            totalBytes: totalMem,
            freeBytes: freeMem,
            usedBytes: usedMem,
            usedPct: Math.round(memUsedPct * 10) / 10,
          },
          disk: disk.ok ? disk.disks : null,
          diskError: disk.ok ? null : disk.reason,
        },
        artifacts: [],
        previews: [{
          type: "text",
          title: "System metrics",
          content: `CPU: ${Math.round(cpuUsedPct)}% | RAM: ${Math.round(memUsedPct)}%` + (disk.ok ? "" : ` | Disk: ${disk.reason}`),
        }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("SYSTEM_MONITOR_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 2) SYSTEM OPS PLAN (INSTALL/UNINSTALL + USER MGMT)
// ============================================================================

const systemOpsPlanSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("install"),
    packageName: z.string().min(1).describe("Package name (OS or language ecosystem)"),
    ecosystem: z.enum(["os", "python", "node", "rust"]).default("os").describe("Where to install from"),
  }),
  z.object({
    operation: z.literal("uninstall"),
    packageName: z.string().min(1).describe("Package name (OS or language ecosystem)"),
    ecosystem: z.enum(["os", "python", "node", "rust"]).default("os").describe("Where to uninstall from"),
  }),
  z.object({
    operation: z.literal("create_user"),
    username: z.string().min(1).describe("Username to create"),
    isAdmin: z.boolean().default(false).describe("Try to add user to admin group (plan only)"),
  }),
  z.object({
    operation: z.literal("delete_user"),
    username: z.string().min(1).describe("Username to delete"),
    removeHome: z.boolean().default(true).describe("Remove home directory (plan only)"),
  }),
  z.object({
    operation: z.literal("list_users"),
  }),
]);

export const systemOpsPlanTool: ToolDefinition = {
  name: "system_ops_plan",
  description: "Plan cross-platform system operations: install/uninstall software and create/manage system users (Linux/macOS/Windows). Returns recommended commands (does not execute).",
  inputSchema: systemOpsPlanSchema,
  capabilities: [],
  execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const detected = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
      const commands: Array<{ os: string; command: string; notes?: string }> = [];

      const pkg = input.packageName ? String(input.packageName) : "";
      const user = input.username ? String(input.username) : "";
      const ecosystem = input.ecosystem ? String(input.ecosystem) : "os";

      const addOsInstall = () => {
        if (detected === "linux") {
          commands.push({ os: "linux", command: `sudo apt-get update && sudo apt-get install -y ${pkg}`, notes: "Debian/Ubuntu" });
          commands.push({ os: "linux", command: `sudo dnf install -y ${pkg}`, notes: "Fedora/RHEL" });
          commands.push({ os: "linux", command: `sudo pacman -S --noconfirm ${pkg}`, notes: "Arch" });
        } else if (detected === "macos") {
          commands.push({ os: "macos", command: `brew install ${pkg}`, notes: "Homebrew" });
        } else {
          commands.push({ os: "windows", command: `winget install --id ${pkg} -e`, notes: "winget (preferred)" });
          commands.push({ os: "windows", command: `choco install ${pkg} -y`, notes: "Chocolatey" });
        }
      };

      const addOsUninstall = () => {
        if (detected === "linux") {
          commands.push({ os: "linux", command: `sudo apt-get remove -y ${pkg}`, notes: "Debian/Ubuntu" });
          commands.push({ os: "linux", command: `sudo dnf remove -y ${pkg}`, notes: "Fedora/RHEL" });
          commands.push({ os: "linux", command: `sudo pacman -R --noconfirm ${pkg}`, notes: "Arch" });
        } else if (detected === "macos") {
          commands.push({ os: "macos", command: `brew uninstall ${pkg}`, notes: "Homebrew" });
        } else {
          commands.push({ os: "windows", command: `winget uninstall --id ${pkg} -e`, notes: "winget" });
          commands.push({ os: "windows", command: `choco uninstall ${pkg} -y`, notes: "Chocolatey" });
        }
      };

      const addEcosystemOps = (op: "install" | "uninstall") => {
        if (ecosystem === "python") {
          commands.push({ os: "any", command: `python -m venv .venv && . .venv/bin/activate && pip ${op === "install" ? "install" : "uninstall -y"} ${pkg}`, notes: "Virtualenv recommended" });
          commands.push({ os: "any", command: `uv pip ${op === "install" ? "install" : "uninstall"} ${pkg}`, notes: "uv (fast pip replacement)" });
        } else if (ecosystem === "node") {
          commands.push({ os: "any", command: `npm ${op === "install" ? "install" : "uninstall"} ${pkg}` });
          commands.push({ os: "any", command: `pnpm ${op === "install" ? "add" : "remove"} ${pkg}` });
        } else if (ecosystem === "rust") {
          commands.push({ os: "any", command: `cargo ${op === "install" ? "install" : "uninstall"} ${pkg}` });
        }
      };

      const addUserCreate = () => {
        if (detected === "linux") {
          commands.push({ os: "linux", command: `sudo useradd -m ${user}` });
          if (input.isAdmin) commands.push({ os: "linux", command: `sudo usermod -aG sudo ${user}`, notes: "Admin group (Debian/Ubuntu)" });
        } else if (detected === "macos") {
          commands.push({ os: "macos", command: `sudo sysadminctl -addUser ${user} -password <TEMP_PASSWORD>`, notes: "Requires admin privileges" });
          if (input.isAdmin) commands.push({ os: "macos", command: `sudo dseditgroup -o edit -a ${user} -t user admin`, notes: "Add to admin group" });
        } else {
          commands.push({ os: "windows", command: `net user ${user} <TEMP_PASSWORD> /add` });
          if (input.isAdmin) commands.push({ os: "windows", command: `net localgroup Administrators ${user} /add` });
        }
      };

      const addUserDelete = () => {
        if (detected === "linux") {
          commands.push({ os: "linux", command: input.removeHome ? `sudo userdel -r ${user}` : `sudo userdel ${user}` });
        } else if (detected === "macos") {
          commands.push({ os: "macos", command: `sudo sysadminctl -deleteUser ${user}`, notes: "May leave home folder depending on config" });
        } else {
          commands.push({ os: "windows", command: `net user ${user} /delete` });
        }
      };

      const addUserList = () => {
        if (detected === "linux") commands.push({ os: "linux", command: `cut -d: -f1 /etc/passwd | sort` });
        else if (detected === "macos") commands.push({ os: "macos", command: `dscl . list /Users | sort` });
        else commands.push({ os: "windows", command: `wmic useraccount get name,sid` });
      };

      if (input.operation === "install") {
        if (ecosystem === "os") addOsInstall();
        else addEcosystemOps("install");
      } else if (input.operation === "uninstall") {
        if (ecosystem === "os") addOsUninstall();
        else addEcosystemOps("uninstall");
      } else if (input.operation === "create_user") {
        addUserCreate();
      } else if (input.operation === "delete_user") {
        addUserDelete();
      } else if (input.operation === "list_users") {
        addUserList();
      }

      return {
        success: true,
        output: {
          operation: input.operation,
          detectedPlatform: detected,
          planOnly: true,
          commands,
          securityNote: "These are recommended commands only. Review before executing. Use the existing shell tool only with explicit confirmation for risky commands.",
        },
        artifacts: [],
        previews: [{
          type: "text",
          title: "System ops plan",
          content: commands.map((c) => `[${c.os}] ${c.command}`).join("\n") || "No commands generated",
        }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("SYSTEM_OPS_PLAN_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 3) PROCESS KILL (GUARDED)
// ============================================================================

const processKillSchema = z.object({
  pid: z.number().int().positive().describe("Process ID to terminate"),
  signal: z.enum(["SIGTERM", "SIGKILL"]).default("SIGTERM").describe("Signal to send (Windows maps to taskkill)"),
  expectedCommandSubstring: z.string().optional().describe("Safety check: substring that must appear in the process command line"),
  dryRun: z.boolean().default(true).describe("If true, do not kill; only return the planned command"),
});

export const processKillTool: ToolDefinition = {
  name: "process_kill",
  description: "Terminate an unresponsive process by PID with safety checks. Supports dry-run and optional command-line verification.",
  inputSchema: processKillSchema,
  capabilities: [],
  execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const pid = Number(input.pid);
      if (!Number.isInteger(pid) || pid <= 1) {
        throw new Error("Refusing to target PID <= 1");
      }
      if (pid === process.pid) {
        throw new Error("Refusing to kill the server process");
      }

      let info: any = { pid };
      try {
        if (process.platform === "win32") {
          const { stdout } = await execFileAsync("wmic", ["process", "where", `ProcessId=${pid}`, "get", "Name,CommandLine,ProcessId", "/format:list"], { timeout: 8000 });
          info.raw = stdout.trim();
        } else {
          const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "pid=,ppid=,user=,comm=,args="], { timeout: 8000 });
          info.raw = stdout.trim();
        }
      } catch (e: any) {
        info.raw = null;
        info.lookupError = e?.message || "Failed to lookup process";
      }

      const expected = input.expectedCommandSubstring ? String(input.expectedCommandSubstring) : null;
      if (expected && info.raw && !info.raw.includes(expected)) {
        throw new Error("Safety check failed: expectedCommandSubstring not found in process command line");
      }

      const planned = process.platform === "win32"
        ? (input.signal === "SIGKILL" ? `taskkill /PID ${pid} /T /F` : `taskkill /PID ${pid} /T`)
        : (input.signal === "SIGKILL" ? `kill -KILL ${pid}` : `kill -TERM ${pid}`);

      if (input.dryRun) {
        return {
          success: true,
          output: { dryRun: true, plannedCommand: planned, info },
          artifacts: [],
          previews: [{ type: "text", title: "Process kill (dry-run)", content: planned + (info.raw ? `\n\nps/wmic:\n${info.raw}` : "") }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (!context.isConfirmed) {
        return {
          success: false,
          output: { plannedCommand: planned, info },
          error: createError("CONFIRMATION_REQUIRED", "This action requires explicit confirmation", false),
          artifacts: [],
          previews: [{ type: "text", title: "Confirmation required", content: planned }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (process.platform === "win32") {
        const execArgs = input.signal === "SIGKILL" ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/T"];
        const { stdout, stderr } = await execFileAsync("taskkill", execArgs, { timeout: 15000 });
        return {
          success: true,
          output: { pid, signal: input.signal, plannedCommand: planned, stdout, stderr, info },
          artifacts: [],
          previews: [{ type: "text", title: "Process terminated", content: stdout || stderr || planned }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      process.kill(pid, input.signal);
      return {
        success: true,
        output: { pid, signal: input.signal, plannedCommand: planned, info },
        artifacts: [],
        previews: [{ type: "text", title: "Process terminated", content: planned }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("PROCESS_KILL_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 4) BACKUP ZIP (AUTOMATED BACKUP ARTIFACT)
// ============================================================================

const backupZipSchema = z.object({
  roots: z.array(z.string()).min(1).default(["."]).describe("Paths to include (relative to project root)"),
  excludeDirNames: z.array(z.string()).default(["node_modules", "dist", ".git", "artifacts", "generated_artifacts", "backups", ".cache", ".next", ".turbo"]).describe("Directory names to skip"),
  maxFiles: z.number().int().min(1).max(20000).default(4000).describe("Safety limit for number of files"),
  maxBytes: z.number().int().min(1).max(1024 * 1024 * 1024).default(150 * 1024 * 1024).describe("Safety limit for total bytes read"),
  outputName: z.string().optional().describe("Optional output filename (without extension)"),
});

export const backupZipTool: ToolDefinition = {
  name: "backup_zip",
  description: "Create automatic system backups (backups automáticos del sistema) as a zip artifact of selected project paths. Supports restore-friendly snapshots and produces a downloadable .zip under /api/artifacts/.",
  inputSchema: backupZipSchema,
  capabilities: ["reads_files", "writes_files", "produces_artifacts"],
  execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const roots: string[] = Array.isArray(input.roots) ? input.roots.map(String) : ["."];
      const exclude = new Set<string>((input.excludeDirNames || []).map(String));
      const maxFiles = clamp(Number(input.maxFiles ?? 4000), 1, 20000);
      const maxBytes = clamp(Number(input.maxBytes ?? 150 * 1024 * 1024), 1, 1024 * 1024 * 1024);

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();

      let fileCount = 0;
      let bytesRead = 0;

      const addPath = async (absPath: string, relBase: string) => {
        const st = await fs.stat(absPath);
        if (st.isDirectory()) {
          const base = path.basename(absPath);
          if (exclude.has(base)) return;
          const entries = await fs.readdir(absPath);
          for (const entry of entries) {
            await addPath(path.join(absPath, entry), path.join(relBase, entry));
          }
          return;
        }

        if (!st.isFile()) return;
        fileCount++;
        if (fileCount > maxFiles) {
          throw new Error(`Backup aborted: maxFiles exceeded (${maxFiles})`);
        }
        bytesRead += st.size;
        if (bytesRead > maxBytes) {
          throw new Error(`Backup aborted: maxBytes exceeded (${maxBytes})`);
        }
        const data = await fs.readFile(absPath);
        zip.file(relBase.replace(/^[\\/]+/, ""), data);
      };

      for (const root of roots) {
        const resolved = safeResolveInsideCwd(root);
        if (!resolved.ok) throw new Error(resolved.reason);
        const relBase = path.relative(process.cwd(), resolved.absPath) || ".";
        await addPath(resolved.absPath, relBase);
      }

      const buffer: Buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });

      const artifactsDir = path.join(process.cwd(), "artifacts");
      await fs.mkdir(artifactsDir, { recursive: true });
      const baseName = input.outputName
        ? String(input.outputName).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80)
        : `backup_${Date.now()}`;
      const filename = `${baseName}.zip`;
      const outPath = path.join(artifactsDir, filename);
      await fs.writeFile(outPath, buffer);

      const downloadUrl = `/api/artifacts/${filename}`;
      return {
        success: true,
        output: {
          filename,
          downloadUrl,
          fileCount,
          bytesRead,
          zipBytes: buffer.length,
        },
        artifacts: [createArtifact("file", filename, { path: outPath, size: buffer.length }, "application/zip", downloadUrl)],
        previews: [{ type: "text", title: "Backup created", content: `${filename}\n${downloadUrl}\nfiles=${fileCount} bytesRead=${bytesRead}` }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime, bytesProcessed: bytesRead },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("BACKUP_ZIP_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 5) CALENDAR ASSISTANT (REMINDERS, MEETING TIMES, FOCUS BLOCKS)
// ============================================================================

const timeRangeSchema = z.object({
  start: z.string().describe("Start datetime (ISO 8601)"),
  end: z.string().describe("End datetime (ISO 8601)"),
});

const calendarEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.string().describe("Start datetime (ISO 8601)"),
  end: z.string().describe("End datetime (ISO 8601)"),
  attendees: z.array(z.string().email()).default([]),
  remindersMinutes: z.array(z.number().int().min(0).max(7 * 24 * 60)).default([30, 10]),
  recurrence: z.object({
    frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(365).default(1),
    count: z.number().int().min(1).max(3650).optional(),
    until: z.string().optional().describe("ISO date/time for UNTIL"),
    byDay: z.array(z.string()).optional().describe("BYDAY values like MO,TU,WE"),
  }).optional(),
});

const calendarAssistantSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("generate_ics"),
    events: z.array(calendarEventSchema).min(1),
    outputName: z.string().optional().describe("Optional output filename (without extension)"),
  }),
  z.object({
    operation: z.literal("suggest_meeting_times"),
    windowStart: z.string().describe("Start of search window (ISO 8601)"),
    windowEnd: z.string().describe("End of search window (ISO 8601)"),
    durationMinutes: z.number().int().min(5).max(8 * 60).describe("Meeting duration in minutes"),
    workingHours: z.object({ startHour: z.number().int().min(0).max(23).default(9), endHour: z.number().int().min(1).max(24).default(17) }).default({ startHour: 9, endHour: 17 }),
    busy: z.array(timeRangeSchema).default([]).describe("Busy time ranges to avoid"),
    maxSuggestions: z.number().int().min(1).max(20).default(5),
  }),
  z.object({
    operation: z.literal("plan_focus_time"),
    startDate: z.string().describe("Start date/time (ISO 8601)"),
    days: z.number().int().min(1).max(30).default(5),
    blockMinutes: z.number().int().min(15).max(4 * 60).default(90),
    blocksPerDay: z.number().int().min(1).max(4).default(1),
    workingHours: z.object({ startHour: z.number().int().min(0).max(23).default(9), endHour: z.number().int().min(1).max(24).default(17) }).default({ startHour: 9, endHour: 17 }),
    busy: z.array(timeRangeSchema).default([]),
    title: z.string().default("Focus time"),
    outputIcs: z.boolean().default(true),
  }),
]);

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function isBusy(candidateStartMs: number, candidateEndMs: number, busy: Array<{ start: string; end: string }>): boolean {
  for (const r of busy) {
    const s = Date.parse(r.start);
    const e = Date.parse(r.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (rangesOverlap(candidateStartMs, candidateEndMs, s, e)) return true;
  }
  return false;
}

export const calendarAssistantTool: ToolDefinition = {
  name: "calendar_assistant",
  description: "Calendar assistant: enviar recordatorios antes de eventos, sugerir horarios optimos para reuniones, y bloquear tiempo de enfoque automaticamente. Can generate .ics calendar files with VALARM reminders and focus blocks.",
  inputSchema: calendarAssistantSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      if (input.operation === "suggest_meeting_times") {
        const start = new Date(input.windowStart);
        const end = new Date(input.windowEnd);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) throw new Error("Invalid windowStart/windowEnd");

        const durationMin = Number(input.durationMinutes);
        const durationMs = durationMin * 60_000;
        const busy = Array.isArray(input.busy) ? input.busy : [];
        const wh = input.workingHours || { startHour: 9, endHour: 17 };

        const suggestions: Array<{ start: string; end: string; score: number }> = [];
        const stepMs = 30 * 60_000; // 30m grid
        const maxSuggestions = clamp(Number(input.maxSuggestions ?? 5), 1, 20);

        // Scan in local time, but output ISO.
        for (let t = start.getTime(); t + durationMs <= end.getTime(); t += stepMs) {
          const d = new Date(t);
          const hour = d.getHours();
          if (hour < wh.startHour || hour >= wh.endHour) continue;
          const candidateStart = t;
          const candidateEnd = t + durationMs;
          if (isBusy(candidateStart, candidateEnd, busy)) continue;

          // Simple scoring: prefer top of hour and nearer times.
          let score = 50;
          if (d.getMinutes() === 0) score += 10;
          const daysAhead = (candidateStart - Date.now()) / (24 * 60 * 60 * 1000);
          score -= Math.max(0, daysAhead) * 2;
          suggestions.push({ start: new Date(candidateStart).toISOString(), end: new Date(candidateEnd).toISOString(), score: Math.round(score * 10) / 10 });
          if (suggestions.length >= 200) break;
        }

        suggestions.sort((a, b) => b.score - a.score);
        const top = suggestions.slice(0, maxSuggestions);

        return {
          success: true,
          output: { suggestions: top, count: top.length },
          artifacts: [],
          previews: [{
            type: "text",
            title: "Meeting time suggestions",
            content: top.map((s) => `${s.start} -> ${s.end} (score ${s.score})`).join("\n") || "No available slots found",
          }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const buildIcs = (events: Array<z.infer<typeof calendarEventSchema>>) => {
        const now = new Date();
        const lines: string[] = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//ILIAGPT//Calendar Assistant//EN",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
        ];

        for (const ev of events) {
          const uid = `${randomUUID()}@iliagpt.local`;
          const dtstamp = icsDateUtc(now);
          const start = new Date(ev.start);
          const end = new Date(ev.end);
          if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
            throw new Error("Invalid event start/end");
          }

          lines.push("BEGIN:VEVENT");
          lines.push(`UID:${uid}`);
          lines.push(`DTSTAMP:${dtstamp}`);
          lines.push(`DTSTART:${icsDateUtc(start)}`);
          lines.push(`DTEND:${icsDateUtc(end)}`);
          lines.push(`SUMMARY:${icsEscape(ev.title)}`);
          if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
          if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);

          for (const a of ev.attendees || []) {
            lines.push(`ATTENDEE:MAILTO:${icsEscape(a)}`);
          }

          if (ev.recurrence) {
            const freq = ev.recurrence.frequency.toUpperCase();
            let rule = `FREQ=${freq};INTERVAL=${ev.recurrence.interval || 1}`;
            if (ev.recurrence.count) rule += `;COUNT=${ev.recurrence.count}`;
            if (ev.recurrence.until) {
              const until = new Date(ev.recurrence.until);
              if (!isNaN(until.getTime())) rule += `;UNTIL=${icsDateUtc(until)}`;
            }
            if (ev.recurrence.byDay?.length) rule += `;BYDAY=${ev.recurrence.byDay.join(",")}`;
            lines.push(`RRULE:${rule}`);
          }

          const reminders = (ev.remindersMinutes || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
          for (const minutes of reminders) {
            lines.push("BEGIN:VALARM");
            lines.push(`TRIGGER:-PT${Math.round(minutes)}M`);
            lines.push("ACTION:DISPLAY");
            lines.push(`DESCRIPTION:${icsEscape(`Reminder: ${ev.title}`)}`);
            lines.push("END:VALARM");
          }

          lines.push("END:VEVENT");
        }

        lines.push("END:VCALENDAR");
        return lines.join("\r\n") + "\r\n";
      };

      if (input.operation === "plan_focus_time") {
        const startDate = new Date(input.startDate);
        if (isNaN(startDate.getTime())) throw new Error("Invalid startDate");
        const days = clamp(Number(input.days ?? 5), 1, 30);
        const blockMinutes = clamp(Number(input.blockMinutes ?? 90), 15, 240);
        const blocksPerDay = clamp(Number(input.blocksPerDay ?? 1), 1, 4);
        const wh = input.workingHours || { startHour: 9, endHour: 17 };
        const busy = Array.isArray(input.busy) ? input.busy : [];
        const title = String(input.title || "Focus time");

        const events: Array<z.infer<typeof calendarEventSchema>> = [];
        for (let day = 0; day < days; day++) {
          const d = new Date(startDate);
          d.setDate(d.getDate() + day);
          d.setHours(wh.startHour, 0, 0, 0);

          let placed = 0;
          // Try placing blocks on a 30m grid.
          for (let t = d.getTime(); t < d.getTime() + (wh.endHour - wh.startHour) * 60 * 60_000; t += 30 * 60_000) {
            if (placed >= blocksPerDay) break;
            const endMs = t + blockMinutes * 60_000;
            const endHour = new Date(endMs).getHours() + new Date(endMs).getMinutes() / 60;
            if (endHour > wh.endHour) break;
            if (isBusy(t, endMs, busy)) continue;
            events.push({
              title,
              description: "Auto-blocked focus time",
              start: new Date(t).toISOString(),
              end: new Date(endMs).toISOString(),
              attendees: [],
              remindersMinutes: [10],
            });
            placed++;
          }
        }

        if (!input.outputIcs) {
          return {
            success: true,
            output: { events, count: events.length, ics: null },
            artifacts: [],
            previews: [{ type: "text", title: "Focus blocks", content: events.map((e) => `${e.start} -> ${e.end} ${e.title}`).join("\n") || "No focus blocks planned" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const ics = buildIcs(events);
        const artifactsDir = path.join(process.cwd(), "artifacts");
        await fs.mkdir(artifactsDir, { recursive: true });
        const baseName = input.outputName ? String(input.outputName).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) : `focus_${Date.now()}`;
        const filename = `${baseName}.ics`;
        const outPath = path.join(artifactsDir, filename);
        await fs.writeFile(outPath, ics, "utf-8");
        const downloadUrl = `/api/artifacts/${filename}`;

        return {
          success: true,
          output: { events, count: events.length, filename, downloadUrl },
          artifacts: [createArtifact("file", filename, { path: outPath, size: ics.length }, "text/calendar", downloadUrl)],
          previews: [{ type: "text", title: "Focus blocks (ICS)", content: `${filename}\n${downloadUrl}\ncount=${events.length}` }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime, bytesProcessed: ics.length },
        };
      }

      // generate_ics
      const events = Array.isArray(input.events) ? input.events : [];
      const ics = buildIcs(events);
      const artifactsDir = path.join(process.cwd(), "artifacts");
      await fs.mkdir(artifactsDir, { recursive: true });
      const baseName = input.outputName ? String(input.outputName).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) : `calendar_${Date.now()}`;
      const filename = `${baseName}.ics`;
      const outPath = path.join(artifactsDir, filename);
      await fs.writeFile(outPath, ics, "utf-8");
      const downloadUrl = `/api/artifacts/${filename}`;

      return {
        success: true,
        output: { filename, downloadUrl, eventCount: events.length },
        artifacts: [createArtifact("file", filename, { path: outPath, size: ics.length }, "text/calendar", downloadUrl)],
        previews: [{ type: "text", title: "Calendar file created", content: `${filename}\n${downloadUrl}` }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime, bytesProcessed: ics.length },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("CALENDAR_ASSISTANT_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 6) WEB AUTH HELPER (LOGIN/OAUTH GUIDANCE)
// ============================================================================

const webAuthHelperSchema = z.object({
  platform: z.string().optional().describe("Platform/site name (e.g., Google, GitHub, Shopify)"),
  authFlow: z.enum(["oauth2", "sso", "magic_link", "password"]).default("oauth2"),
  goal: z.string().optional().describe("What you are trying to access"),
});

export const webAuthHelperTool: ToolDefinition = {
  name: "web_auth_helper",
  description: "Help with login flows (OAuth2/SSO) and authorization: steps, scopes, redirect URLs, and secure token storage patterns.",
  inputSchema: webAuthHelperSchema,
  capabilities: [],
  execute: async (input: any): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const platform = input.platform ? String(input.platform) : "the platform";
      const flow = input.authFlow || "oauth2";
      const goal = input.goal ? String(input.goal) : "";

      const guidance: string[] = [];
      guidance.push(`Auth flow: ${flow}`);
      if (goal) guidance.push(`Goal: ${goal}`);
      guidance.push("");

      if (flow === "oauth2") {
        guidance.push(`OAuth2 checklist for ${platform}:`);
        guidance.push("1) Confirm redirect URI(s) match exactly (scheme/host/path).");
        guidance.push("2) Request the minimum scopes required. Add offline/refresh if you need long-lived access.");
        guidance.push("3) Store access tokens server-side only; never commit secrets to git. Prefer encrypted DB storage.");
        guidance.push("4) Implement refresh-token rotation handling and expiry checks.");
        guidance.push("5) Use PKCE for public clients; use Authorization Code grant for server apps.");
        guidance.push("6) Log auth errors without leaking tokens; rotate secrets if exposed.");
      } else if (flow === "sso") {
        guidance.push("SSO checklist:");
        guidance.push("1) Confirm IdP metadata and certificate rotation strategy.");
        guidance.push("2) Map claims to roles (least privilege).");
        guidance.push("3) Enforce session timeouts and re-auth for high-risk operations.");
      } else if (flow === "magic_link") {
        guidance.push("Magic-link checklist:");
        guidance.push("1) Single-use token, short TTL, bind to user-agent/IP when possible.");
        guidance.push("2) Rate-limit requests; prevent user enumeration.");
      } else {
        guidance.push("Password login checklist:");
        guidance.push("1) Argon2id/bcrypt with strong parameters; per-user salt.");
        guidance.push("2) MFA for admin; lockout and rate limiting.");
      }

      return {
        success: true,
        output: { platform, authFlow: flow, guidance: guidance.join("\n") },
        artifacts: [],
        previews: [{ type: "text", title: "Auth helper", content: guidance.join("\n") }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("WEB_AUTH_HELPER_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 7) PRICE COMPARE (WEB SEARCH + EXTRACTION)
// ============================================================================

const priceCompareSchema = z.object({
  product: z.string().min(1).describe("Product name/model to compare"),
  region: z.string().optional().describe("Optional region/country hint (e.g., US, MX, ES)"),
  currency: z.string().optional().describe("Preferred currency hint (e.g., USD, MXN, EUR)"),
  maxResults: z.number().int().min(1).max(10).default(5),
  fetchPages: z.boolean().default(false).describe("If true, fetch top pages to extract prices (slower)"),
});

export const priceCompareTool: ToolDefinition = {
  name: "price_compare",
  description: "Compare product prices across online stores by searching the web and extracting price candidates from snippets (and optionally page content).",
  inputSchema: priceCompareSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input: any): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const product = String(input.product);
      const region = input.region ? String(input.region) : "";
      const maxResults = clamp(Number(input.maxResults ?? 5), 1, 10);
      const fetchPages = Boolean(input.fetchPages);

      const { searchWeb, fetchPageContent } = await import("../services/webSearch");
      const query = `${product} precio${region ? ` ${region}` : ""}`;
      const res = await searchWeb(query, Math.max(5, maxResults));
      const results = (res.results || []).slice(0, maxResults);

      const offers: Array<{ title: string; url: string; currency?: string; price?: number; evidence?: string }> = [];

      for (const r of results) {
        const snippet = r.snippet || "";
        let candidates = parseMoneyCandidates(snippet);
        let evidence = snippet;

        if (fetchPages && candidates.length === 0) {
          const page = await fetchPageContent(r.url);
          if (page?.text) {
            const sample = page.text.slice(0, 4000);
            const pageCandidates = parseMoneyCandidates(sample);
            if (pageCandidates.length > 0) {
              candidates = pageCandidates;
              evidence = sample.slice(0, 280);
            }
          }
        }

        const best = candidates.sort((a, b) => a.value - b.value)[0];
        offers.push({
          title: r.title,
          url: r.url,
          currency: best?.currency,
          price: best?.value,
          evidence: best ? `${best.raw}` : (evidence ? evidence.slice(0, 180) : undefined),
        });
      }

      const withPrice = offers.filter((o) => typeof o.price === "number" && Number.isFinite(o.price));
      withPrice.sort((a, b) => (a.price! - b.price!));

      const summary = withPrice.length
        ? { min: withPrice[0], max: withPrice[withPrice.length - 1], countWithPrice: withPrice.length, countTotal: offers.length }
        : { countWithPrice: 0, countTotal: offers.length };

      return {
        success: true,
        output: { query, summary, offers: offers.slice(0, maxResults) },
        artifacts: [],
        previews: [{
          type: "text",
          title: "Price comparison",
          content: withPrice.length
            ? withPrice.slice(0, maxResults).map((o) => `${o.price} ${o.currency || ""} | ${o.title}\n${o.url}`).join("\n\n")
            : offers.map((o) => `${o.title}\n${o.url}`).join("\n\n"),
        }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime, apiCalls: 1 },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("PRICE_COMPARE_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 8) DATA FORECAST (LIGHTWEIGHT ML)
// ============================================================================

const dataForecastSchema = z.object({
  series: z.array(z.number()).min(2).describe("Numeric time series values in chronological order"),
  horizon: z.number().int().min(1).max(365).default(7).describe("Number of future points to predict"),
  method: z.enum(["linear_regression", "moving_average"]).default("linear_regression"),
  window: z.number().int().min(2).max(120).default(7).describe("Window size for moving average"),
});

export const dataForecastTool: ToolDefinition = {
  name: "data_forecast",
  description: "Make simple predictions using lightweight machine learning methods (linear regression or moving average) over numeric time series.",
  inputSchema: dataForecastSchema,
  capabilities: [],
  execute: async (input: any): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const series: number[] = (input.series || []).map(Number).filter((n: any) => Number.isFinite(n));
      if (series.length < 2) throw new Error("series must contain at least 2 numeric points");
      const horizon = clamp(Number(input.horizon ?? 7), 1, 365);
      const method = input.method || "linear_regression";
      const window = clamp(Number(input.window ?? 7), 2, 120);

      const predictions: number[] = [];

      if (method === "moving_average") {
        for (let i = 0; i < horizon; i++) {
          const startIdx = Math.max(0, series.length - window);
          const slice = series.slice(startIdx);
          const avg = slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length);
          predictions.push(avg);
          series.push(avg);
        }
      } else {
        const ss = await import("simple-statistics");
        const points: Array<[number, number]> = series.map((y, x) => [x, y]);
        const lr = ss.linearRegression(points);
        const line = ss.linearRegressionLine(lr);
        for (let i = 0; i < horizon; i++) {
          predictions.push(line(series.length + i));
        }
      }

      return {
        success: true,
        output: {
          method,
          horizon,
          predictions: predictions.map((n) => Math.round(n * 1000) / 1000),
        },
        artifacts: [],
        previews: [{ type: "text", title: "Forecast", content: `method=${method} horizon=${horizon}\n` + predictions.slice(0, 20).map((n) => String(Math.round(n * 1000) / 1000)).join(", ") }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("DATA_FORECAST_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 9) REALTIME AGGREGATE (STREAM-LIKE WINDOW OPS)
// ============================================================================

const realtimeAggregateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("index"),
    metric: z.enum(["rolling_mean", "rolling_sum", "rolling_min", "rolling_max"]).default("rolling_mean"),
    values: z.array(z.number()).min(1),
    windowSize: z.number().int().min(1).max(10000).default(10),
  }),
  z.object({
    mode: z.literal("time"),
    metric: z.enum(["rolling_mean", "rolling_sum", "rolling_min", "rolling_max"]).default("rolling_mean"),
    points: z.array(z.object({ t: z.union([z.string(), z.number()]), value: z.number() })).min(1),
    windowMs: z.number().int().min(1000).max(24 * 60 * 60_000).default(60_000),
  }),
]);

export const realtimeAggregateTool: ToolDefinition = {
  name: "realtime_aggregate",
  description: "Process data in real time via rolling-window aggregation (mean/sum/min/max) over indexed series or timestamped points.",
  inputSchema: realtimeAggregateSchema,
  capabilities: [],
  execute: async (input: any): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const metric = input.metric || "rolling_mean";
      const agg = (arr: number[]) => {
        if (arr.length === 0) return null;
        if (metric === "rolling_sum") return arr.reduce((s, v) => s + v, 0);
        if (metric === "rolling_min") return Math.min(...arr);
        if (metric === "rolling_max") return Math.max(...arr);
        return arr.reduce((s, v) => s + v, 0) / arr.length;
      };

      if (input.mode === "index") {
        const values: number[] = (input.values || []).map(Number).filter((n: any) => Number.isFinite(n));
        const w = clamp(Number(input.windowSize ?? 10), 1, 10000);
        const out: Array<number | null> = [];
        for (let i = 0; i < values.length; i++) {
          const startIdx = Math.max(0, i - w + 1);
          out.push(agg(values.slice(startIdx, i + 1)));
        }
        return {
          success: true,
          output: { mode: "index", metric, windowSize: w, aggregated: out },
          artifacts: [],
          previews: [{ type: "text", title: "Realtime aggregate", content: `mode=index metric=${metric} windowSize=${w}\n` + out.slice(-20).map((v) => (v === null ? "null" : String(Math.round(v * 1000) / 1000))).join(", ") }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      // time mode
      const points = (input.points || []).map((p: any) => ({
        t: typeof p.t === "number" ? p.t : Date.parse(String(p.t)),
        value: Number(p.value),
      })).filter((p: any) => Number.isFinite(p.t) && Number.isFinite(p.value))
        .sort((a: any, b: any) => a.t - b.t);
      const windowMs = clamp(Number(input.windowMs ?? 60_000), 1000, 24 * 60 * 60_000);
      const aggregated: Array<{ t: number; value: number | null }> = [];
      for (let i = 0; i < points.length; i++) {
        const t = points[i].t;
        const startT = t - windowMs;
        const windowVals = points.filter((p: any) => p.t >= startT && p.t <= t).map((p: any) => p.value);
        aggregated.push({ t, value: agg(windowVals) });
      }

      return {
        success: true,
        output: { mode: "time", metric, windowMs, aggregated },
        artifacts: [],
        previews: [{ type: "text", title: "Realtime aggregate", content: `mode=time metric=${metric} windowMs=${windowMs}\npoints=${aggregated.length}` }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("REALTIME_AGGREGATE_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// 10) PERSONAL MEMORY (PROJECTS, CONTACTS, ANTICIPATION, FEEDBACK)
// ============================================================================

const personalMemorySchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("upsert_project"),
    projectName: z.string().min(1),
    status: z.string().min(1),
    nextSteps: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
  }),
  z.object({
    operation: z.literal("upsert_contact"),
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    relationship: z.string().optional(),
    notes: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
  z.object({
    operation: z.literal("list_projects"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  z.object({
    operation: z.literal("list_contacts"),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  z.object({
    operation: z.literal("search"),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  z.object({
    operation: z.literal("anticipate_needs"),
    context: z.string().min(1).describe("Current context to anticipate needs from"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  z.object({
    operation: z.literal("learn_from_feedback"),
    feedback: z.string().min(1).describe("User feedback about a past response or outcome"),
    tags: z.array(z.string()).default([]),
  }),
]);

export const personalMemoryTool: ToolDefinition = {
  name: "personal_memory",
  description: "Personal memory for projects and contacts: remember project status, store relationships, anticipate needs, and improve responses from past feedback.",
  inputSchema: personalMemorySchema,
  capabilities: [],
  execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const { semanticMemoryStore } = await import("../memory/SemanticMemoryStore");
      await semanticMemoryStore.initialize();

      const userId = context.userId || "anonymous";

      if (input.operation === "upsert_project") {
        const projectName = String(input.projectName);
        const status = String(input.status);
        const nextSteps = Array.isArray(input.nextSteps) ? input.nextSteps.map(String) : [];
        const tags = ["project", projectName, ...(Array.isArray(input.tags) ? input.tags.map(String) : [])];
        const content = [
          `Project: ${projectName}`,
          `Status: ${status}`,
          nextSteps.length ? `Next steps: ${nextSteps.join("; ")}` : "",
        ].filter(Boolean).join("\n");

        const chunk = await semanticMemoryStore.remember(userId, content, "note", { source: "project", confidence: 0.9, tags });
        return {
          success: true,
          output: { stored: true, id: chunk.id, projectName, status },
          artifacts: [],
          previews: [{ type: "text", title: "Project remembered", content }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.operation === "upsert_contact") {
        const name = String(input.name);
        const email = input.email ? String(input.email) : "";
        const phone = input.phone ? String(input.phone) : "";
        const relationship = input.relationship ? String(input.relationship) : "";
        const notes = input.notes ? String(input.notes) : "";
        const tags = ["contact", name, ...(Array.isArray(input.tags) ? input.tags.map(String) : [])];
        const content = [
          `Contact: ${name}`,
          email ? `Email: ${email}` : "",
          phone ? `Phone: ${phone}` : "",
          relationship ? `Relationship: ${relationship}` : "",
          notes ? `Notes: ${notes}` : "",
        ].filter(Boolean).join("\n");

        const chunk = await semanticMemoryStore.remember(userId, content, "fact", { source: "contact", confidence: 0.9, tags });
        return {
          success: true,
          output: { stored: true, id: chunk.id, name, email: email || null, phone: phone || null },
          artifacts: [],
          previews: [{ type: "text", title: "Contact remembered", content }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.operation === "list_projects") {
        const limit = clamp(Number(input.limit ?? 10), 1, 50);
        const results = await semanticMemoryStore.search(userId, "Project:", { limit, types: ["note"], hybridSearch: true });
        return {
          success: true,
          output: { projects: results.map((r: any) => ({ score: r.score, content: r.chunk.content, id: r.chunk.id })), count: results.length },
          artifacts: [],
          previews: [{ type: "text", title: "Projects", content: results.map((r: any) => `(${Math.round(r.score * 100) / 100}) ${r.chunk.content.split("\n")[0]}`).join("\n") || "No projects" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.operation === "list_contacts") {
        const limit = clamp(Number(input.limit ?? 10), 1, 50);
        const results = await semanticMemoryStore.search(userId, "Contact:", { limit, types: ["fact"], hybridSearch: true });
        return {
          success: true,
          output: { contacts: results.map((r: any) => ({ score: r.score, content: r.chunk.content, id: r.chunk.id })), count: results.length },
          artifacts: [],
          previews: [{ type: "text", title: "Contacts", content: results.map((r: any) => `(${Math.round(r.score * 100) / 100}) ${r.chunk.content.split("\n")[0]}`).join("\n") || "No contacts" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.operation === "search") {
        const limit = clamp(Number(input.limit ?? 10), 1, 20);
        const query = String(input.query);
        const results = await semanticMemoryStore.search(userId, query, { limit, hybridSearch: true });
        return {
          success: true,
          output: { results: results.map((r: any) => ({ score: r.score, type: r.chunk.type, content: r.chunk.content, id: r.chunk.id })), count: results.length },
          artifacts: [],
          previews: [{ type: "text", title: "Memory search", content: results.map((r: any) => `(${Math.round(r.score * 100) / 100}) [${r.chunk.type}] ${r.chunk.content.slice(0, 140)}`).join("\n") || "No results" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.operation === "anticipate_needs") {
        const limit = clamp(Number(input.limit ?? 8), 1, 20);
        const ctx = String(input.context);
        const related = await semanticMemoryStore.search(userId, ctx, { limit, hybridSearch: true });
        const suggestions: string[] = [];
        for (const r of related) {
          const firstLine = String(r.chunk.content || "").split("\n")[0];
          if (firstLine) suggestions.push(`Related: ${firstLine}`);
        }
        if (suggestions.length === 0) {
          suggestions.push("No strong prior memories found. Ask for: deadlines, stakeholders, budget, and the desired output format.");
        }
        return {
          success: true,
          output: { suggestions, related: related.map((r: any) => ({ score: r.score, content: r.chunk.content, id: r.chunk.id })), count: related.length },
          artifacts: [],
          previews: [{ type: "text", title: "Anticipated needs", content: suggestions.join("\n") }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      // learn_from_feedback
      const feedback = String(input.feedback);
      const tags = ["feedback", ...(Array.isArray(input.tags) ? input.tags.map(String) : [])];
      const content = `Feedback: ${feedback}`;
      const chunk = await semanticMemoryStore.remember(userId, content, "instruction", { source: "feedback", confidence: 0.85, tags });
      return {
        success: true,
        output: { stored: true, id: chunk.id },
        artifacts: [],
        previews: [{ type: "text", title: "Feedback learned", content }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("PERSONAL_MEMORY_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

// ============================================================================
// EXPORT: Tools that close remaining gaps from Super Agente Digital 100
// ============================================================================

export const superAgentMissingTools: ToolDefinition[] = [
  systemMonitorTool,
  systemOpsPlanTool,
  processKillTool,
  backupZipTool,
  calendarAssistantTool,
  webAuthHelperTool,
  priceCompareTool,
  dataForecastTool,
  realtimeAggregateTool,
  personalMemoryTool,
];

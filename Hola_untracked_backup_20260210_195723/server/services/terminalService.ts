/**
 * Terminal Interactive Service
 * Capabilities 501-550: PTY, sandbox, streaming, security, git, docker,
 * process management, compression, network diagnostics, log viewing, grep.
 *
 * Builds on existing infrastructure:
 *   - server/agent/tools/terminalControl.ts      (RBAC, audit, policy)
 *   - server/agent/computerUse/terminalController.ts (session model, safety)
 *   - server/agent/security/shellCommandPolicy.ts (dangerous-pattern list)
 *   - server/agent/pipeline/tools/shell-execute.ts (sandboxed exec)
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);

// ============================================================================
// Constants
// ============================================================================

const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB
const DEFAULT_TIMEOUT_MS = 30_000;  // 30 s
const MAX_TIMEOUT_MS = 300_000;     // 5 min
const MAX_HISTORY_PER_SESSION = 200;
const SESSION_TTL_MS = 3_600_000;   // 1 h idle before auto-cleanup

// ============================================================================
// Types
// ============================================================================

export interface TerminalSession {
  id: string;
  pid?: number;
  createdAt: Date;
  lastActivity: Date;
  history: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
}

export interface DangerCheckResult {
  dangerous: boolean;
  reason?: string;
}

export interface SystemInfoResult {
  platform: string;
  arch: string;
  hostname: string;
  cpus: number;
  totalMemory: string;
  freeMemory: string;
  uptime: string;
  loadAvg: number[];
}

export interface ProcessEntry {
  pid: number;
  name: string;
  cpu: string;
  memory: string;
}

// ============================================================================
// Session store
// ============================================================================

const sessions = new Map<string, TerminalSession>();
let sessionCounter = 0;

// Periodic stale-session reaper (runs every 10 min)
const _reaperInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.lastActivity.getTime() > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 600_000);
// Allow Node to exit even if the interval is active
if (_reaperInterval.unref) _reaperInterval.unref();

// ============================================================================
// Dangerous-command detection
// ============================================================================

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\//, reason: "Recursive forced deletion of root filesystem" },
  { pattern: /mkfs\./, reason: "Filesystem formatting command" },
  { pattern: /dd\s+if=.*of=\/dev/, reason: "Direct disk write via dd" },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "Writing directly to block device" },
  { pattern: /chmod\s+-R\s+777\s+\//, reason: "Recursive world-writable permissions on root" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/, reason: "Fork bomb detected" },
  { pattern: /wget.*\|\s*sh/, reason: "Remote code execution via wget pipe to sh" },
  { pattern: /curl.*\|\s*bash/, reason: "Remote code execution via curl pipe to bash" },
  { pattern: /\biptables\s+-F/, reason: "Firewall flush" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/, reason: "System shutdown/reboot command" },
];

const BLACKLISTED_COMMANDS: string[] = [
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
  "rm -rf /",
  "rm -rf /*",
];

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function sanitizeTimeout(ms?: number): number {
  if (!ms || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(ms, MAX_TIMEOUT_MS);
}

// Protected PIDs that must never be killed (pid 0, 1, and the current process).
function isProtectedPid(pid: number): boolean {
  return pid <= 1 || pid === process.pid;
}

// ============================================================================
// Session management
// ============================================================================

export function createSession(env?: Record<string, string>): TerminalSession {
  sessionCounter++;
  const id = `term-${sessionCounter}-${randomUUID().slice(0, 8)}`;
  const session: TerminalSession = {
    id,
    createdAt: new Date(),
    lastActivity: new Date(),
    history: [],
    env: { ...process.env as Record<string, string>, ...env },
    cwd: process.cwd(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(sessionId: string): TerminalSession | null {
  return sessions.get(sessionId) ?? null;
}

export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values());
}

export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

// ============================================================================
// Core execution
// ============================================================================

export async function executeCommand(
  sessionId: string,
  command: string,
  options?: {
    timeout?: number;
    cwd?: string;
    env?: Record<string, string>;
  },
): Promise<ExecuteResult> {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      stdout: "",
      stderr: `Session not found: ${sessionId}`,
      exitCode: -1,
      durationMs: 0,
      truncated: false,
    };
  }

  // Safety gate
  const dangerCheck = isDangerousCommand(command);
  if (dangerCheck.dangerous) {
    return {
      stdout: "",
      stderr: `BLOCKED: ${dangerCheck.reason}`,
      exitCode: -1,
      durationMs: 0,
      truncated: false,
    };
  }

  const timeout = sanitizeTimeout(options?.timeout);
  const cwd = options?.cwd || session.cwd;
  const env = { ...session.env, ...options?.env };

  const start = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      env,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: "/bin/bash",
    });

    const durationMs = Date.now() - start;
    const truncated = (stdout?.length ?? 0) >= MAX_OUTPUT_BYTES;

    // Track in history
    session.history.push(command);
    if (session.history.length > MAX_HISTORY_PER_SESSION) {
      session.history = session.history.slice(-MAX_HISTORY_PER_SESSION);
    }
    session.lastActivity = new Date();

    return {
      stdout: truncated ? stdout.slice(0, MAX_OUTPUT_BYTES) : stdout,
      stderr: stderr || "",
      exitCode: 0,
      durationMs,
      truncated,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;

    session.history.push(command);
    if (session.history.length > MAX_HISTORY_PER_SESSION) {
      session.history = session.history.slice(-MAX_HISTORY_PER_SESSION);
    }
    session.lastActivity = new Date();

    return {
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message || "Unknown error",
      exitCode: typeof err.code === "number" ? err.code : (err.status ?? 1),
      durationMs,
      truncated: false,
    };
  }
}

// ============================================================================
// Safety checks
// ============================================================================

export function isDangerousCommand(command: string): DangerCheckResult {
  const trimmed = command.trim().toLowerCase();

  // Exact blacklist match
  for (const blocked of BLACKLISTED_COMMANDS) {
    if (trimmed === blocked || trimmed.startsWith(blocked + " ")) {
      return { dangerous: true, reason: `Blacklisted command: "${blocked}"` };
    }
  }

  // Pattern match
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { dangerous: true, reason };
    }
  }

  return { dangerous: false };
}

// ============================================================================
// Error correction suggestions
// ============================================================================

const CORRECTION_MAP: Array<{ errorPattern: RegExp; suggestion: string }> = [
  { errorPattern: /command not found:\s*(\S+)/, suggestion: "Check if '{cmd}' is installed or in your PATH. Try: which {cmd}" },
  { errorPattern: /No such file or directory/, suggestion: "Verify the file path exists. Try: ls -la <parent_directory>" },
  { errorPattern: /Permission denied/, suggestion: "You may need elevated permissions. Check ownership with: ls -la <path>" },
  { errorPattern: /EACCES/, suggestion: "Access denied. Check file permissions with: ls -la <path>" },
  { errorPattern: /ENOENT/, suggestion: "File or directory does not exist. Verify the path." },
  { errorPattern: /ETIMEDOUT/, suggestion: "Command timed out. Try increasing the timeout or simplify the operation." },
  { errorPattern: /ECONNREFUSED/, suggestion: "Connection refused. Verify the target host/port is running." },
  { errorPattern: /fatal: not a git repository/, suggestion: "Not inside a git repository. Use: git init   or cd into a valid repo." },
  { errorPattern: /npm ERR! code ENOENT/, suggestion: "Missing package.json or referenced file. Run: npm init   or check paths." },
  { errorPattern: /SyntaxError/, suggestion: "Check for syntax errors in the command or script." },
  { errorPattern: /Cannot find module/, suggestion: "Module not found. Try: npm install <module_name>" },
];

export function suggestCorrection(command: string, error: string): string | null {
  for (const { errorPattern, suggestion } of CORRECTION_MAP) {
    const match = error.match(errorPattern);
    if (match) {
      // Replace {cmd} placeholder if we captured the command name
      let result = suggestion;
      if (match[1]) {
        result = result.replace(/\{cmd\}/g, match[1]);
      }
      return result;
    }
  }
  return null;
}

// ============================================================================
// Session history
// ============================================================================

export function getCommandHistory(sessionId: string): string[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return [...session.history];
}

// ============================================================================
// System information
// ============================================================================

export async function getSystemInfo(): Promise<SystemInfoResult> {
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: formatBytes(os.totalmem()),
    freeMemory: formatBytes(os.freemem()),
    uptime: formatUptime(os.uptime()),
    loadAvg: os.loadavg(),
  };
}

// ============================================================================
// Process management
// ============================================================================

export async function getProcessList(): Promise<ProcessEntry[]> {
  try {
    const isMac = os.platform() === "darwin";
    // macOS ps does not support --sort; use -m for memory sort
    const cmd = isMac
      ? "ps -eo pid,comm,%cpu,%mem | head -50"
      : "ps -eo pid,comm,%cpu,%mem --sort=-%mem | head -50";

    const { stdout } = await execAsync(cmd, { timeout: 10_000 });
    const lines = stdout.trim().split("\n").slice(1); // skip header

    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return null;
        return {
          pid: parseInt(parts[0], 10),
          name: parts[1],
          cpu: parts[2],
          memory: parts[3],
        };
      })
      .filter((entry): entry is ProcessEntry => entry !== null && !isNaN(entry.pid));
  } catch {
    return [];
  }
}

export async function killProcess(pid: number, signal?: string): Promise<boolean> {
  if (isProtectedPid(pid)) {
    throw new Error(`Refusing to kill protected PID ${pid}`);
  }

  try {
    const sig = (signal || "SIGTERM") as NodeJS.Signals;
    process.kill(pid, sig);
    return true;
  } catch (err: any) {
    if (err.code === "ESRCH") {
      // Process does not exist — already gone
      return false;
    }
    throw err;
  }
}

// ============================================================================
// Git helpers
// ============================================================================

export async function gitStatus(cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync("git status", {
      cwd: cwd || process.cwd(),
      timeout: 15_000,
    });
    return stdout || stderr;
  } catch (err: any) {
    return err.stderr || err.message || "git status failed";
  }
}

export async function gitDiff(cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync("git diff", {
      cwd: cwd || process.cwd(),
      timeout: 15_000,
    });
    return stdout || stderr || "(no differences)";
  } catch (err: any) {
    return err.stderr || err.message || "git diff failed";
  }
}

export async function gitLog(count?: number, cwd?: string): Promise<string> {
  const n = Math.min(Math.max(count || 10, 1), 200);
  try {
    const { stdout, stderr } = await execAsync(`git log --oneline -n ${n}`, {
      cwd: cwd || process.cwd(),
      timeout: 15_000,
    });
    return stdout || stderr || "(no commits)";
  } catch (err: any) {
    return err.stderr || err.message || "git log failed";
  }
}

// ============================================================================
// File diff
// ============================================================================

export async function fileDiff(file1: string, file2: string): Promise<string> {
  // Validate paths exist
  try {
    await fs.access(file1);
  } catch {
    return `File not found: ${file1}`;
  }
  try {
    await fs.access(file2);
  } catch {
    return `File not found: ${file2}`;
  }

  try {
    const { stdout } = await execAsync(
      `diff -u "${file1}" "${file2}"`,
      { timeout: 15_000, maxBuffer: MAX_OUTPUT_BYTES },
    );
    return stdout || "(files are identical)";
  } catch (err: any) {
    // diff exits 1 when files differ — that is normal
    if (err.code === 1 && err.stdout) {
      return err.stdout;
    }
    return err.stderr || err.message || "diff failed";
  }
}

// ============================================================================
// Compression
// ============================================================================

export async function compressFiles(
  files: string[],
  outputPath: string,
  format: "zip" | "tar.gz" = "tar.gz",
): Promise<string> {
  if (!files.length) {
    return "No files provided for compression.";
  }

  // Validate that all source files exist
  for (const f of files) {
    try {
      await fs.access(f);
    } catch {
      return `Source not found: ${f}`;
    }
  }

  const escapedFiles = files.map((f) => `"${f}"`).join(" ");

  try {
    if (format === "zip") {
      const { stdout, stderr } = await execAsync(
        `zip -r "${outputPath}" ${escapedFiles}`,
        { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
      return stdout || stderr || `Created ${outputPath}`;
    }

    // tar.gz
    const { stdout, stderr } = await execAsync(
      `tar -czf "${outputPath}" ${escapedFiles}`,
      { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
    );
    return stdout || stderr || `Created ${outputPath}`;
  } catch (err: any) {
    return err.stderr || err.message || "Compression failed";
  }
}

export async function decompressFile(
  filePath: string,
  outputDir?: string,
): Promise<string> {
  try {
    await fs.access(filePath);
  } catch {
    return `Archive not found: ${filePath}`;
  }

  const dest = outputDir || path.dirname(filePath);

  try {
    await fs.mkdir(dest, { recursive: true });
  } catch {
    // directory may already exist
  }

  const ext = filePath.toLowerCase();

  try {
    if (ext.endsWith(".zip")) {
      const { stdout, stderr } = await execAsync(
        `unzip -o "${filePath}" -d "${dest}"`,
        { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
      return stdout || stderr || `Extracted to ${dest}`;
    }

    if (ext.endsWith(".tar.gz") || ext.endsWith(".tgz")) {
      const { stdout, stderr } = await execAsync(
        `tar -xzf "${filePath}" -C "${dest}"`,
        { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
      return stdout || stderr || `Extracted to ${dest}`;
    }

    if (ext.endsWith(".tar.bz2")) {
      const { stdout, stderr } = await execAsync(
        `tar -xjf "${filePath}" -C "${dest}"`,
        { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
      return stdout || stderr || `Extracted to ${dest}`;
    }

    if (ext.endsWith(".tar")) {
      const { stdout, stderr } = await execAsync(
        `tar -xf "${filePath}" -C "${dest}"`,
        { timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
      return stdout || stderr || `Extracted to ${dest}`;
    }

    return `Unsupported archive format: ${path.extname(filePath)}`;
  } catch (err: any) {
    return err.stderr || err.message || "Decompression failed";
  }
}

// ============================================================================
// Network diagnostics
// ============================================================================

export async function networkDiagnostics(
  host: string,
  type: "ping" | "traceroute" | "dns" | "port",
): Promise<string> {
  // Basic host validation — prevent injection through the host param
  if (!/^[\w.\-:[\]]+$/.test(host)) {
    return "Invalid host format.";
  }

  const isMac = os.platform() === "darwin";

  try {
    switch (type) {
      case "ping": {
        // -c 4 on Unix, -n 4 on Windows (but we're targeting Unix here)
        const { stdout, stderr } = await execAsync(
          `ping -c 4 "${host}"`,
          { timeout: 20_000 },
        );
        return stdout || stderr;
      }

      case "traceroute": {
        const cmd = isMac ? "traceroute" : "traceroute";
        const { stdout, stderr } = await execAsync(
          `${cmd} -m 15 "${host}"`,
          { timeout: 60_000 },
        );
        return stdout || stderr;
      }

      case "dns": {
        // Use nslookup which is available on both macOS and Linux
        const { stdout, stderr } = await execAsync(
          `nslookup "${host}"`,
          { timeout: 15_000 },
        );
        return stdout || stderr;
      }

      case "port": {
        // host may be "hostname:port"
        const parts = host.split(":");
        const hostname = parts[0];
        const port = parts[1] || "80";

        if (!/^\d+$/.test(port) || parseInt(port) < 1 || parseInt(port) > 65535) {
          return `Invalid port: ${port}. Use format host:port`;
        }

        // Use bash /dev/tcp or nc for port checking
        const { stdout, stderr } = await execAsync(
          `nc -z -w 5 "${hostname}" ${port} 2>&1 && echo "Port ${port} is OPEN" || echo "Port ${port} is CLOSED"`,
          { timeout: 15_000 },
        );
        return stdout || stderr;
      }

      default:
        return `Unknown diagnostic type: ${type}`;
    }
  } catch (err: any) {
    return err.stdout || err.stderr || err.message || `${type} failed for ${host}`;
  }
}

// ============================================================================
// Log viewing
// ============================================================================

export async function viewLogs(
  logPath: string,
  lines?: number,
  filter?: string,
): Promise<string> {
  try {
    await fs.access(logPath);
  } catch {
    return `Log file not found: ${logPath}`;
  }

  const n = Math.min(Math.max(lines || 100, 1), 5000);

  try {
    let cmd = `tail -n ${n} "${logPath}"`;

    if (filter) {
      // Escape single quotes in the filter for safe shell usage
      const safeFilter = filter.replace(/'/g, "'\\''");
      cmd += ` | grep -i '${safeFilter}'`;
    }

    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 15_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    if (!stdout && !stderr) {
      return filter
        ? `No lines matching "${filter}" in the last ${n} lines of ${logPath}`
        : `(empty — no output from last ${n} lines)`;
    }

    return stdout || stderr;
  } catch (err: any) {
    // grep exits 1 when no lines match — that is normal
    if (err.code === 1 && !err.stderr) {
      return filter
        ? `No lines matching "${filter}" in the last ${n} lines of ${logPath}`
        : "(no output)";
    }
    return err.stderr || err.message || "Failed to read log file";
  }
}

// ============================================================================
// Grep
// ============================================================================

export async function grepFiles(
  pattern: string,
  directory: string,
  options?: {
    recursive?: boolean;
    ignoreCase?: boolean;
    fileGlob?: string;
  },
): Promise<string> {
  try {
    await fs.access(directory);
  } catch {
    return `Directory not found: ${directory}`;
  }

  // Escape single quotes in the pattern
  const safePattern = pattern.replace(/'/g, "'\\''");

  const flags: string[] = ["-n"]; // always show line numbers
  if (options?.recursive !== false) flags.push("-r");
  if (options?.ignoreCase) flags.push("-i");

  let includeGlob = "";
  if (options?.fileGlob) {
    // Escape single quotes in glob
    const safeGlob = options.fileGlob.replace(/'/g, "'\\''");
    includeGlob = ` --include='${safeGlob}'`;
  }

  const cmd = `grep ${flags.join(" ")}${includeGlob} '${safePattern}' "${directory}" 2>/dev/null | head -500`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    if (!stdout) {
      return `No matches found for "${pattern}" in ${directory}`;
    }

    return stdout;
  } catch (err: any) {
    // grep exits 1 when no match — that is normal
    if (err.code === 1) {
      return `No matches found for "${pattern}" in ${directory}`;
    }
    return err.stderr || err.message || "grep failed";
  }
}

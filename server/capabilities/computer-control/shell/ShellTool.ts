/**
 * ShellTool — Secure shell execution with PTY, risk classification,
 * dry-run mode, streaming, rate limits, timeouts, and kill-switch.
 *
 * Risk Classification:
 * - LOW: read-only commands (ls, cat, echo, pwd, whoami, git status, etc.)
 * - MEDIUM: write commands (cp, mv, mkdir, git add/commit, npm install, etc.)
 * - HIGH: system-modifying (apt install, brew install, docker run, pip install)
 * - CRITICAL: destructive/elevated (rm -rf, sudo, dd, mkfs, reboot, iptables -F)
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import { RiskLevel, ControlPolicy, CommandRiskAssessment, ControlAuditEntry } from "../types";

// ── Risk Patterns ────────────────────────────────

const CRITICAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-rf?|--recursive)\s+\//i, reason: "Recursive deletion of root or system path" },
  { pattern: /mkfs\./i, reason: "Filesystem formatting" },
  { pattern: /dd\s+if=.*of=\/dev\//i, reason: "Direct disk write" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i, reason: "Fork bomb" },
  { pattern: /shutdown|reboot|poweroff|init\s+[06]/i, reason: "System shutdown/reboot" },
  { pattern: /iptables\s+-F/i, reason: "Firewall flush" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "Writing to disk device" },
  { pattern: /curl.*\|\s*(?:bash|sh)/i, reason: "Remote code execution pipe" },
  { pattern: /wget.*\|\s*(?:bash|sh)/i, reason: "Remote code execution pipe" },
  { pattern: /chmod\s+-R\s+777\s+\//i, reason: "Recursive permission change on root" },
];

const HIGH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /sudo\s/i, reason: "Elevated privileges (sudo)" },
  { pattern: /apt\s+(install|remove|purge|autoremove)/i, reason: "System package management" },
  { pattern: /brew\s+(install|uninstall|remove)/i, reason: "System package management (Homebrew)" },
  { pattern: /pip3?\s+install/i, reason: "Python package installation" },
  { pattern: /npm\s+(install|uninstall)\s+-g/i, reason: "Global npm package management" },
  { pattern: /docker\s+(run|rm|rmi|system\s+prune)/i, reason: "Docker container management" },
  { pattern: /systemctl\s+(start|stop|restart|enable|disable)/i, reason: "Service management" },
  { pattern: /kill\s+-9/i, reason: "Force kill process" },
  { pattern: /rm\s+-rf?\s/i, reason: "Recursive file deletion" },
];

const MEDIUM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /cp\s/i, reason: "File copy" },
  { pattern: /mv\s/i, reason: "File move" },
  { pattern: /mkdir\s/i, reason: "Directory creation" },
  { pattern: /touch\s/i, reason: "File creation" },
  { pattern: /git\s+(add|commit|push|merge|rebase|reset)/i, reason: "Git write operation" },
  { pattern: /npm\s+(install|run|build)/i, reason: "npm operation" },
  { pattern: /npx\s/i, reason: "npx execution" },
  { pattern: /node\s/i, reason: "Node.js execution" },
  { pattern: /python3?\s/i, reason: "Python execution" },
  { pattern: /tee\s/i, reason: "File write via tee" },
];

const LOW_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "whoami",
  "date", "uname", "hostname", "wc", "sort", "uniq", "diff", "file",
  "which", "type", "env", "printenv", "df", "du", "free",
  "top", "ps", "netstat", "ss", "ip", "ifconfig", "ping",
  "git status", "git log", "git diff", "git branch", "git remote",
  "docker ps", "docker images", "docker logs",
  "cd", "tree", "less", "more", "man", "help",
]);

// ── Types ────────────────────────────────────────

export interface ShellCommandRequest {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  stream?: boolean;
  dryRun?: boolean;
  userId: string;
  sessionId: string;
  confirmationToken?: string;
}

export interface ShellCommandResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed: boolean;
  timedOut: boolean;
  riskAssessment: CommandRiskAssessment;
  dryRun: boolean;
}

// ── ShellTool ────────────────────────────────────

const DEFAULT_POLICY: ControlPolicy = {
  mode: "SUPERVISED",
  autoApprovePatterns: [],
  requireConfirmPatterns: [],
  blockPatterns: [],
  maxConcurrent: 5,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  killSwitchEnabled: true,
  binaryAllowlist: [],
  pathAllowlist: [],
};

export class ShellTool extends EventEmitter {
  private policy: ControlPolicy;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private auditLog: ControlAuditEntry[] = [];
  private maxAuditEntries = 50_000;
  private killSwitchActive = false;
  private commandRateWindow: { start: number; count: number } = { start: Date.now(), count: 0 };
  private rateWindowMs = 60_000;
  private maxCommandsPerWindow = 60;

  constructor(policy?: Partial<ControlPolicy>) {
    super();
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  // ── Risk Assessment ────────────────────────────

  assessRisk(command: string): CommandRiskAssessment {
    const trimmed = command.trim();
    const reasons: string[] = [];
    let riskLevel: RiskLevel = "LOW";
    let blocked = false;

    // Check blocked patterns from policy
    for (const pattern of this.policy.blockPatterns) {
      if (new RegExp(pattern, "i").test(trimmed)) {
        return {
          command: trimmed,
          riskLevel: "CRITICAL",
          reasons: [`Blocked by policy: ${pattern}`],
          requiresConfirmation: false,
          blocked: true,
        };
      }
    }

    // Check CRITICAL patterns
    for (const { pattern, reason } of CRITICAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        riskLevel = "CRITICAL";
        reasons.push(reason);
        blocked = this.policy.mode === "SAFE";
      }
    }

    // Check HIGH patterns (only if not already CRITICAL)
    if (riskLevel !== "CRITICAL") {
      for (const { pattern, reason } of HIGH_PATTERNS) {
        if (pattern.test(trimmed)) {
          riskLevel = "HIGH";
          reasons.push(reason);
        }
      }
    }

    // Check MEDIUM patterns
    if (riskLevel === "LOW") {
      for (const { pattern, reason } of MEDIUM_PATTERNS) {
        if (pattern.test(trimmed)) {
          riskLevel = "MEDIUM";
          reasons.push(reason);
        }
      }
    }

    // Check LOW known commands
    if (reasons.length === 0) {
      const firstWord = trimmed.split(/\s+/)[0];
      if (LOW_COMMANDS.has(firstWord) || LOW_COMMANDS.has(trimmed)) {
        riskLevel = "LOW";
        reasons.push("Read-only command");
      }
    }

    // Determine if confirmation is needed
    let requiresConfirmation = false;
    if (this.policy.mode === "SAFE") {
      requiresConfirmation = riskLevel !== "LOW";
      blocked = riskLevel === "CRITICAL";
    } else if (this.policy.mode === "SUPERVISED") {
      requiresConfirmation = riskLevel === "HIGH" || riskLevel === "CRITICAL";
      blocked = false;
    } else {
      // AUTOPILOT
      requiresConfirmation = riskLevel === "CRITICAL";
      blocked = false;
    }

    // Policy overrides
    for (const pattern of this.policy.requireConfirmPatterns) {
      if (new RegExp(pattern, "i").test(trimmed)) {
        requiresConfirmation = true;
      }
    }
    for (const pattern of this.policy.autoApprovePatterns) {
      if (new RegExp(pattern, "i").test(trimmed)) {
        requiresConfirmation = false;
      }
    }

    return { command: trimmed, riskLevel, reasons, requiresConfirmation, blocked };
  }

  // ── Command Execution ──────────────────────────

  async execute(request: ShellCommandRequest): Promise<ShellCommandResult> {
    const id = randomUUID();
    const start = Date.now();

    // Kill switch check
    if (this.killSwitchActive) {
      throw new Error("Kill switch is active. All command execution is halted.");
    }

    // Rate limiting
    this.enforceRateLimit();

    // Concurrency check
    if (this.activeProcesses.size >= this.policy.maxConcurrent) {
      throw new Error(`Max concurrent commands reached (${this.policy.maxConcurrent})`);
    }

    const assessment = this.assessRisk(request.command);

    // Blocked check
    if (assessment.blocked) {
      this.logAudit({
        id,
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        tool: "shell",
        action: request.command,
        riskLevel: assessment.riskLevel,
        approved: false,
        deniedReason: `Command blocked: ${assessment.reasons.join(", ")}`,
      });
      throw new Error(`Command blocked (${assessment.riskLevel}): ${assessment.reasons.join(", ")}`);
    }

    // Confirmation check (in SAFE/SUPERVISED mode)
    if (assessment.requiresConfirmation && !request.confirmationToken) {
      this.emit("confirmation_required", {
        id,
        command: request.command,
        riskLevel: assessment.riskLevel,
        reasons: assessment.reasons,
      });

      return {
        id,
        command: request.command,
        exitCode: null,
        stdout: "",
        stderr: `Confirmation required (${assessment.riskLevel}): ${assessment.reasons.join(", ")}`,
        durationMs: Date.now() - start,
        killed: false,
        timedOut: false,
        riskAssessment: assessment,
        dryRun: false,
      };
    }

    // Dry-run mode
    if (request.dryRun) {
      this.logAudit({
        id,
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        tool: "shell",
        action: request.command,
        riskLevel: assessment.riskLevel,
        approved: true,
        metadata: { dryRun: true },
      });

      return {
        id,
        command: request.command,
        exitCode: 0,
        stdout: `[DRY-RUN] Would execute: ${request.command}\nRisk: ${assessment.riskLevel}\nReasons: ${assessment.reasons.join(", ")}`,
        stderr: "",
        durationMs: Date.now() - start,
        killed: false,
        timedOut: false,
        riskAssessment: assessment,
        dryRun: true,
      };
    }

    // Execute command
    const timeout = Math.min(
      request.timeout || this.policy.defaultTimeoutMs,
      this.policy.maxTimeoutMs,
    );

    const result = await this.spawnCommand(id, request.command, {
      cwd: request.cwd || process.cwd(),
      env: this.buildSafeEnv(request.env),
      timeout,
      stream: request.stream || false,
    });

    this.logAudit({
      id,
      timestamp: Date.now(),
      userId: request.userId,
      sessionId: request.sessionId,
      tool: "shell",
      action: request.command,
      riskLevel: assessment.riskLevel,
      approved: true,
      result: {
        exitCode: result.exitCode ?? undefined,
        success: result.exitCode === 0,
        durationMs: result.durationMs,
      },
    });

    return { ...result, riskAssessment: assessment, dryRun: false };
  }

  // ── Kill Switch ────────────────────────────────

  activateKillSwitch(): void {
    this.killSwitchActive = true;
    for (const [id, proc] of this.activeProcesses) {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }
    this.activeProcesses.clear();
    this.emit("kill_switch_activated");
  }

  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    this.emit("kill_switch_deactivated");
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  // ── Policy ─────────────────────────────────────

  updatePolicy(update: Partial<ControlPolicy>): void {
    this.policy = { ...this.policy, ...update };
  }

  getPolicy(): Readonly<ControlPolicy> {
    return { ...this.policy };
  }

  // ── Audit ──────────────────────────────────────

  getAuditLog(limit = 100): ControlAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  // ── Private ────────────────────────────────────

  private async spawnCommand(
    id: string,
    command: string,
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; stream: boolean },
  ): Promise<Omit<ShellCommandResult, "riskAssessment" | "dryRun">> {
    return new Promise((resolve) => {
      const start = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;
      let timedOut = false;
      let settled = false;

      const proc = spawn(command, {
        shell: this.detectShell(),
        cwd: options.cwd,
        env: options.env,
      });

      this.activeProcesses.set(id, proc);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) proc.kill("SIGKILL");
        }, 5000);
      }, options.timeout);

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stdout += text;
        if (options.stream) {
          this.emit("output", { id, stream: "stdout", chunk: text });
        }
        // Limit output size
        if (stdout.length > 1_000_000) {
          stdout = stdout.slice(-500_000);
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        stderr += text;
        if (options.stream) {
          this.emit("output", { id, stream: "stderr", chunk: text });
        }
        if (stderr.length > 1_000_000) {
          stderr = stderr.slice(-500_000);
        }
      });

      const onFinish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.activeProcesses.delete(id);

        resolve({
          id,
          command,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          killed,
          timedOut,
        });
      };

      proc.on("close", (code) => onFinish(code));
      proc.on("error", (err) => {
        stderr += `\nProcess error: ${err.message}`;
        onFinish(1);
      });
    });
  }

  private detectShell(): string {
    const platform = os.platform();
    if (platform === "win32") return "powershell.exe";
    if (process.env.SHELL) return process.env.SHELL;
    return "/bin/bash";
  }

  private buildSafeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      HOME: os.homedir(),
      LANG: process.env.LANG || "en_US.UTF-8",
      TERM: process.env.TERM || "xterm-256color",
      NODE_ENV: process.env.NODE_ENV || "development",
      ...extra,
    };
  }

  private enforceRateLimit(): void {
    const now = Date.now();
    if (now - this.commandRateWindow.start > this.rateWindowMs) {
      this.commandRateWindow = { start: now, count: 0 };
    }
    this.commandRateWindow.count++;
    if (this.commandRateWindow.count > this.maxCommandsPerWindow) {
      throw new Error(`Rate limit exceeded: max ${this.maxCommandsPerWindow} commands per ${this.rateWindowMs / 1000}s`);
    }
  }

  private logAudit(entry: ControlAuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.maxAuditEntries * 0.8));
    }
  }
}

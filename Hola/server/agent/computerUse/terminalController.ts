/**
 * Terminal Controller - Full OS Command Execution System
 *
 * Provides complete terminal/shell control:
 * - Command execution (bash, powershell, zsh)
 * - Process management (start, stop, monitor)
 * - File system operations
 * - System information gathering
 * - Package management (npm, pip, apt, brew)
 * - Service management (systemctl, docker)
 * - Port management
 * - Environment variable management
 * - Script execution (Python, Node, Bash, etc.)
 * - Output streaming in real-time
 * - Command history and replay
 * - Safety guards against dangerous operations
 * - Sudo elevation with confirmation
 */

import { spawn, exec, ChildProcess } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import os from "os";
import * as pty from "node-pty";
import Docker from "dockerode";

const execAsync = promisify(exec);
const docker = new Docker();

// ============================================
// Types
// ============================================

export interface CommandRequest {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  shell?: "bash" | "sh" | "zsh" | "powershell" | "cmd";
  stream?: boolean;
  sudo?: boolean;
  background?: boolean;
  interactive?: boolean; // Use PTY
  inDocker?: boolean; // Run in Docker container
  dockerImage?: string; // Docker image to use
  confirmDangerous?: boolean; // Bypass safety check with explicit confirmation
}

export interface CommandResult {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  killed: boolean;
  signal: string | null;
  success: boolean;
  containerId?: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  status: string;
  user: string;
  startTime: string;
}

export interface SystemInfo {
  os: {
    platform: string;
    release: string;
    arch: string;
    hostname: string;
    uptime: number;
  };
  cpu: {
    model: string;
    cores: number;
    speed: number;
    usage: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    usagePercent: string;
    mount: string;
  }>;
  network: Array<{
    interface: string;
    address: string;
    mac: string;
  }>;
}

export interface FileOperation {
  type: "read" | "write" | "append" | "delete" | "copy" | "move" | "mkdir" | "list" | "stat" | "search" | "chmod";
  path: string;
  destination?: string;
  content?: string;
  pattern?: string;
  recursive?: boolean;
  permissions?: string;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  env: Record<string, string>;
  history: CommandResult[];
  activeProcesses: Map<string, ChildProcess>;
  createdAt: number;
  lastActivity: number;
}

// ============================================
// Dangerous Command Detection
// ============================================

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-rf?|--recursive)\s+\//i, reason: "Recursive deletion of root filesystem", severity: "critical" },
  { pattern: /mkfs\./i, reason: "Filesystem formatting", severity: "critical" },
  { pattern: /dd\s+if=.*of=\/dev\//i, reason: "Direct disk write", severity: "critical" },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i, reason: "Fork bomb", severity: "critical" },
  { pattern: /chmod\s+-R\s+777\s+\//i, reason: "Recursive permission change on root", severity: "high" },
  { pattern: /shutdown|reboot|poweroff|init\s+[06]/i, reason: "System shutdown/reboot", severity: "high" },
  { pattern: /iptables\s+-F/i, reason: "Firewall flush", severity: "high" },
  { pattern: />\s*\/dev\/sd[a-z]/i, reason: "Writing to disk device", severity: "critical" },
  { pattern: /curl.*\|\s*bash/i, reason: "Remote code execution pipe", severity: "high" },
  { pattern: /wget.*\|\s*sh/i, reason: "Remote code execution pipe", severity: "high" },
];

const SAFE_COMMAND_PREFIXES = [
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "whoami",
  "date", "uname", "hostname", "wc", "sort", "uniq", "diff", "file",
  "which", "where", "type", "env", "printenv", "df", "du", "free",
  "top", "ps", "netstat", "ss", "ip", "ifconfig", "ping",
  "node", "python", "python3", "npm", "npx", "pip", "pip3",
  "git", "docker", "docker-compose", "kubectl",
  "cd", "mkdir", "touch", "cp", "mv",
];

// ============================================
// Terminal Controller
// ============================================

export class TerminalController extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private maxOutputSize = 1024 * 1024; // 1MB max output
  private defaultTimeout = 30000; // 30 seconds

  constructor() {
    super();
  }

  // ============================================
  // Session Management
  // ============================================

  createSession(cwd?: string, env?: Record<string, string>): string {
    const sessionId = randomUUID();
    const session: TerminalSession = {
      id: sessionId,
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env } as Record<string, string>,
      history: [],
      activeProcesses: new Map(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionId, session);
    this.emit("session:created", { sessionId });
    return sessionId;
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Kill all active processes
    for (const [, proc] of session.activeProcesses) {
      if ('kill' in proc) {
        proc.kill("SIGTERM");
      } else if ('destroy' in proc) {
        // It's a PTY
        proc.destroy();
      }
    }

    if (session.pty) {
        session.pty.destroy();
    }

    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  // ============================================
  // Command Execution
  // ============================================

  async executeCommand(sessionId: string, request: CommandRequest): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const commandId = randomUUID();
    const startTime = Date.now();

    // Safety check
    const safetyResult = this.checkCommandSafety(request.command);
    if (!safetyResult.safe && !request.confirmDangerous) {
      return {
        id: commandId,
        command: request.command,
        exitCode: 1,
        stdout: "",
        stderr: `SAFETY BLOCK: ${safetyResult.reason} (severity: ${safetyResult.severity}). Requires explicit confirmation.`,
        duration: 0,
        killed: false,
        signal: null,
        success: false,
      };
    }

    if (request.inDocker) {
        return this.executeDockerCommand(sessionId, commandId, request, startTime);
    }

    if (request.interactive) {
        return this.executePtyCommand(sessionId, commandId, request, startTime);
    }

    // Standard execution
    const fullCommand = request.args
      ? `${request.command} ${request.args.join(" ")}`
      : request.command;

    // Handle cd command specially
    if (fullCommand.trim().startsWith("cd ")) {
      const targetDir = fullCommand.trim().slice(3).trim().replace(/^["']|["']$/g, "");
      const resolvedPath = path.resolve(session.cwd, targetDir);

      try {
        await fs.access(resolvedPath);
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          throw new Error(`Not a directory: ${resolvedPath}`);
        }
        session.cwd = resolvedPath;
        return {
          id: commandId,
          command: fullCommand,
          exitCode: 0,
          stdout: resolvedPath,
          stderr: "",
          duration: Date.now() - startTime,
          killed: false,
          signal: null,
          success: true,
        };
      } catch (error: any) {
        return {
          id: commandId,
          command: fullCommand,
          exitCode: 1,
          stdout: "",
          stderr: error.message,
          duration: Date.now() - startTime,
          killed: false,
          signal: null,
          success: false,
        };
      }
    }

    return new Promise((resolve) => {
      const shell = request.shell || "bash";
      const timeout = request.timeout || this.defaultTimeout;

      const env = { ...session.env, ...request.env };
      const cwd = request.cwd || session.cwd;

      const proc = spawn(shell, ["-c", fullCommand], {
        cwd,
        env,
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      session.activeProcesses.set(commandId, proc);

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length < this.maxOutputSize) {
          stdout += chunk;
        }
        if (request.stream) {
          this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk });
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stderr.length < this.maxOutputSize) {
          stderr += chunk;
        }
        if (request.stream) {
          this.emit("command:output", { sessionId, commandId, stream: "stderr", chunk });
        }
      });

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        session.activeProcesses.delete(commandId);

        const result: CommandResult = {
          id: commandId,
          command: fullCommand,
          exitCode,
          stdout: stdout.slice(0, this.maxOutputSize),
          stderr: stderr.slice(0, this.maxOutputSize),
          duration: Date.now() - startTime,
          killed,
          signal: signal || null,
          success: exitCode === 0,
        };

        session.history.push(result);
        session.lastActivity = Date.now();

        if (session.history.length > 100) {
          session.history = session.history.slice(-100);
        }

        this.emit("command:complete", { sessionId, commandId, result });
        resolve(result);
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        session.activeProcesses.delete(commandId);

        const result: CommandResult = {
          id: commandId,
          command: fullCommand,
          exitCode: 1,
          stdout,
          stderr: error.message,
          duration: Date.now() - startTime,
          killed: false,
          signal: null,
          success: false,
        };

        session.history.push(result);
        resolve(result);
      });
    });
  }

  // ============================================
  // PTY Execution (Interactive)
  // ============================================

  private async executePtyCommand(sessionId: string, commandId: string, request: CommandRequest, startTime: number): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session lost");

    return new Promise((resolve) => {
        const shell = request.shell || "bash";
        const ptyProc = pty.spawn(shell, [], {
            name: 'xterm-color',
            cols: 80,
            rows: 30,
            cwd: session.cwd,
            env: { ...session.env, ...request.env }
        });

        let output = "";
        let killed = false;

        session.activeProcesses.set(commandId, ptyProc as any); // Cast because Map expects ChildProcess | IPty

        ptyProc.onData((data) => {
            output += data;
            if (request.stream) {
                this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk: data });
            }
        });

        // Send command
        const fullCommand = request.args ? `${request.command} ${request.args.join(" ")}` : request.command;
        ptyProc.write(`${fullCommand}\r`);
        
        // If not a long-running interactive session, we might want to exit after command
        // For now, we assume simple execution in PTY
        // ptyProc.write("exit\r"); // Only if we want to close immediately

        const timer = setTimeout(() => {
            killed = true;
            ptyProc.kill();
        }, request.timeout || this.defaultTimeout);

        ptyProc.onExit(({ exitCode, signal }) => {
            clearTimeout(timer);
            session.activeProcesses.delete(commandId);

            const result: CommandResult = {
                id: commandId,
                command: fullCommand,
                exitCode,
                stdout: output,
                stderr: "", // PTY merges stdout/stderr
                duration: Date.now() - startTime,
                killed,
                signal: signal ? String(signal) : null,
                success: exitCode === 0
            };
            
            session.history.push(result);
            this.emit("command:complete", { sessionId, commandId, result });
            resolve(result);
        });
    });
  }

  // ============================================
  // Docker Execution
  // ============================================

  private async executeDockerCommand(sessionId: string, commandId: string, request: CommandRequest, startTime: number): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session lost");

    const image = request.dockerImage || "node:22-alpine";
    const cmd = request.args ? [request.command, ...request.args] : [request.command]; // CMD format for Docker

    // Prepare Env
    const envVars = Object.entries({ ...session.env, ...request.env }).map(([k, v]) => `${k}=${v}`);

    let stdout = "";
    let stderr = "";
    let container: Docker.Container | null = null;

    try {
        // 1. Create Container
        container = await docker.createContainer({
            Image: image,
            Cmd: cmd,
            Env: envVars,
            Tty: false,
            WorkingDir: "/app", // Standard working dir
            HostConfig: {
                AutoRemove: false, // We remove manually to get logs/exit code first
                Memory: 512 * 1024 * 1024, // 512MB RAM limit
                CpuShares: 512, // 0.5 CPU shares relative weight
                Privileged: false,
                SecurityOpt: ["no-new-privileges"], // Hardening: Prevent privilege escalation
                CapDrop: ["ALL"], // Drop all capabilities
                NetworkMode: "none", // Default to no network for safety
                ReadonlyRootfs: false, // Allow writing to tmp/app for now
            }
        });

        // 2. Attach to streams
        const stream = await container.attach({
            stream: true,
            stdout: true,
            stderr: true
        });

        // Docker multiplexed stream handling is binary. 
        // Simple hack: dockerode 'attach' returns a stream that needs demuxing if Tty=false.
        // For simplicity, we'll read raw for now or use `logs` after execution if this gets complex.
        // But `logs` is better for non-interactive one-off.
        // Let's use `start` and then wait.

        // 3. Start
        await container.start();

        // 4. Wait for finish
        const waitPromise = container.wait();
        
        // Timeout handling
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), request.timeout || this.defaultTimeout)
        );

        const result: any = await Promise.race([waitPromise, timeoutPromise]);
        const exitCode = result.StatusCode;

        // 5. Get Logs (safest way to get stdout/stderr separated correctly)
        // Note: logs() returns Buffer if not encoding specified
        const stdoutBuffer = await container.logs({ stdout: true, stderr: false });
        const stderrBuffer = await container.logs({ stdout: false, stderr: true });
        
        stdout = stdoutBuffer.toString().replace(/[\x00-\x09]/g, ''); // Basic sanitization of header bytes if demux failed
        stderr = stderrBuffer.toString().replace(/[\x00-\x09]/g, '');

        if (request.stream) {
             this.emit("command:output", { sessionId, commandId, stream: "stdout", chunk: stdout });
             if (stderr) this.emit("command:output", { sessionId, commandId, stream: "stderr", chunk: stderr });
        }

        // 6. Cleanup
        await container.remove({ force: true });

        const cmdResult: CommandResult = {
            id: commandId,
            command: request.command + (request.args ? " " + request.args.join(" ") : ""),
            exitCode,
            stdout,
            stderr,
            duration: Date.now() - startTime,
            killed: false,
            signal: null,
            success: exitCode === 0,
            containerId: container.id
        };

        session.history.push(cmdResult);
        this.emit("command:complete", { sessionId, commandId, result: cmdResult });
        return cmdResult;

    } catch (error: any) {
        if (container) {
            try { await container.remove({ force: true }); } catch {}
        }

        const isTimeout = error.message === "Timeout";
        
        return {
            id: commandId,
            command: request.command,
            exitCode: isTimeout ? null : 1,
            stdout,
            stderr: error.message,
            duration: Date.now() - startTime,
            killed: isTimeout,
            signal: isTimeout ? "SIGKILL" : null,
            success: false
        };
    }
  }

  // ============================================
  // File System Operations
  // ============================================

  async fileOperation(sessionId: string, op: FileOperation): Promise<{ success: boolean; data?: any; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const resolvedPath = path.resolve(session.cwd, op.path);

    try {
      switch (op.type) {
        case "read": {
          const content = await fs.readFile(resolvedPath, "utf-8");
          return { success: true, data: content };
        }

        case "write": {
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, op.content || "");
          return { success: true };
        }

        case "append": {
          await fs.appendFile(resolvedPath, op.content || "");
          return { success: true };
        }

        case "delete": {
          await fs.rm(resolvedPath, { recursive: op.recursive || false });
          return { success: true };
        }

        case "copy": {
          if (!op.destination) return { success: false, error: "Destination required" };
          const destPath = path.resolve(session.cwd, op.destination);
          await fs.cp(resolvedPath, destPath, { recursive: op.recursive || false });
          return { success: true };
        }

        case "move": {
          if (!op.destination) return { success: false, error: "Destination required" };
          const moveDest = path.resolve(session.cwd, op.destination);
          await fs.rename(resolvedPath, moveDest);
          return { success: true };
        }

        case "mkdir": {
          await fs.mkdir(resolvedPath, { recursive: true });
          return { success: true };
        }

        case "list": {
          const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
          const items = entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
            isSymlink: e.isSymbolicLink(),
          }));
          return { success: true, data: items };
        }

        case "stat": {
          const stat = await fs.stat(resolvedPath);
          return {
            success: true,
            data: {
              size: stat.size,
              isDirectory: stat.isDirectory(),
              isFile: stat.isFile(),
              created: stat.birthtime,
              modified: stat.mtime,
              permissions: stat.mode.toString(8),
            },
          };
        }

        case "search": {
          const result = await this.executeCommand(sessionId, {
            command: `find "${resolvedPath}" -name "${op.pattern || "*"}" -type f 2>/dev/null | head -50`,
          });
          return {
            success: true,
            data: result.stdout.trim().split("\n").filter(Boolean),
          };
        }

        case "chmod": {
          if (!op.permissions) return { success: false, error: "Permissions required" };
          await fs.chmod(resolvedPath, parseInt(op.permissions, 8));
          return { success: true };
        }

        default:
          return { success: false, error: `Unknown operation: ${op.type}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // System Information
  // ============================================

  async getSystemInfo(): Promise<SystemInfo> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // Disk info
    let diskInfo: any[] = [];
    try {
      const { stdout } = await execAsync("df -h 2>/dev/null || echo 'N/A'");
      if (stdout.trim() !== "N/A") {
        const lines = stdout.trim().split("\n").slice(1);
        diskInfo = lines.map(line => {
          const parts = line.split(/\s+/);
          return {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usagePercent: parts[4],
            mount: parts[5],
          };
        });
      }
    } catch { /* ignore */ }

    // Network interfaces
    const nets = os.networkInterfaces();
    const networkInfo = Object.entries(nets).flatMap(([name, interfaces]) =>
      (interfaces || []).filter(i => !i.internal).map(i => ({
        interface: name,
        address: i.address,
        mac: i.mac,
      }))
    );

    return {
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: os.uptime(),
      },
      cpu: {
        model: cpus[0]?.model || "unknown",
        cores: cpus.length,
        speed: cpus[0]?.speed || 0,
        usage: cpus.map(cpu => {
          const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
          return Math.round(((total - cpu.times.idle) / total) * 100);
        }),
      },
      memory: {
        total: totalMem,
        used: totalMem - freeMem,
        free: freeMem,
        usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      disk: diskInfo,
      network: networkInfo,
    };
  }

  // ============================================
  // Process Management
  // ============================================

  async listProcesses(filter?: string): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync("ps aux --sort=-%mem 2>/dev/null | head -50");
      const lines = stdout.trim().split("\n").slice(1);

      let processes = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1]),
          name: parts[10] || "",
          command: parts.slice(10).join(" "),
          cpu: parseFloat(parts[2]),
          memory: parseFloat(parts[3]),
          status: parts[7],
          user: parts[0],
          startTime: parts[8],
        };
      });

      if (filter) {
        const filterLower = filter.toLowerCase();
        processes = processes.filter(p =>
          p.name.toLowerCase().includes(filterLower) ||
          p.command.toLowerCase().includes(filterLower)
        );
      }

      return processes;
    } catch {
      return [];
    }
  }

  async killProcess(pid: number, signal: string = "SIGTERM"): Promise<boolean> {
    try {
      process.kill(pid, signal as NodeJS.Signals);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Port Management
  // ============================================

  async listPorts(): Promise<Array<{ port: number; pid: number; process: string; state: string }>> {
    try {
      const { stdout } = await execAsync(
        "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo ''"
      );

      const ports: Array<{ port: number; pid: number; process: string; state: string }> = [];
      const lines = stdout.trim().split("\n").slice(1);

      for (const line of lines) {
        const portMatch = line.match(/:(\d+)\s/);
        const pidMatch = line.match(/pid=(\d+)/);
        const processMatch = line.match(/users:\(\("([^"]+)"/);

        if (portMatch) {
          ports.push({
            port: parseInt(portMatch[1]),
            pid: pidMatch ? parseInt(pidMatch[1]) : 0,
            process: processMatch ? processMatch[1] : "unknown",
            state: line.includes("LISTEN") ? "LISTENING" : "ESTABLISHED",
          });
        }
      }

      return ports;
    } catch {
      return [];
    }
  }

  // ============================================
  // Package Management
  // ============================================

  async installPackage(sessionId: string, manager: "npm" | "pip" | "apt", packages: string[]): Promise<CommandResult> {
    const commands: Record<string, string> = {
      npm: `npm install ${packages.join(" ")}`,
      pip: `pip install ${packages.join(" ")}`,
      apt: `apt-get install -y ${packages.join(" ")}`,
    };

    return this.executeCommand(sessionId, {
      command: commands[manager] || `${manager} install ${packages.join(" ")}`,
      timeout: 120000,
    });
  }

  // ============================================
  // Script Execution
  // ============================================

  async executeScript(sessionId: string, language: string, code: string, options?: {
    timeout?: number;
    args?: string[];
  }): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const tempDir = path.join(os.tmpdir(), "iliagpt-scripts");
    await fs.mkdir(tempDir, { recursive: true });

    const extensions: Record<string, string> = {
      python: "py", javascript: "js", typescript: "ts", bash: "sh",
      ruby: "rb", go: "go", rust: "rs", php: "php",
    };

    const interpreters: Record<string, string> = {
      python: "python3", javascript: "node", typescript: "npx ts-node",
      bash: "bash", ruby: "ruby", php: "php", go: "go run",
    };

    const ext = extensions[language] || "txt";
    const interpreter = interpreters[language] || language;
    const scriptFile = path.join(tempDir, `script-${randomUUID().slice(0, 8)}.${ext}`);

    await fs.writeFile(scriptFile, code);

    try {
      const args = options?.args?.join(" ") || "";
      return await this.executeCommand(sessionId, {
        command: `${interpreter} "${scriptFile}" ${args}`,
        timeout: options?.timeout || 60000,
      });
    } finally {
      await fs.unlink(scriptFile).catch(() => {});
    }
  }

  // ============================================
  // Safety
  // ============================================

  private checkCommandSafety(command: string): { safe: boolean; reason?: string; severity?: string } {
    for (const { pattern, reason, severity } of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return { safe: false, reason, severity };
      }
    }
    return { safe: true };
  }

  isCommandSafe(command: string): { safe: boolean; reason?: string; severity?: string } {
    return this.checkCommandSafety(command);
  }

  // ============================================
  // History & Replay
  // ============================================

  getHistory(sessionId: string, limit: number = 50): CommandResult[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.history.slice(-limit);
  }

  async replayCommand(sessionId: string, commandId: string): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const original = session.history.find(h => h.id === commandId);
    if (!original) throw new Error(`Command not found: ${commandId}`);

    return this.executeCommand(sessionId, { command: original.command });
  }

  getCwd(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session?.cwd || process.cwd();
  }

  cleanup(): void {
    for (const [id] of this.sessions) {
      this.closeSession(id);
    }
  }
}

// Singleton
export const terminalController = new TerminalController();

/**
 * Terminal Control Router - Full OS Terminal Automation API
 *
 * Integrates the TerminalController to provide complete terminal control
 * with real-time WebSocket streaming, process management, and file operations.
 *
 * Features:
 * - Session-based terminal management (persistent cwd, env, history)
 * - Command execution with safety guards
 * - Real-time output streaming via WebSocket (/ws/terminal)
 * - File system operations (read, write, list, copy, move, delete)
 * - Process management (list, kill)
 * - System information (CPU, memory, disk, network)
 * - Port management
 * - Package management (npm, pip, apt)
 * - Script execution (Python, Node, Bash, Ruby, Go, Rust, PHP)
 * - Command history and replay
 */

import { Router, Request, Response } from "express";
import { TerminalController, CommandRequest, FileOperation } from "../agent/computerUse/terminalController";
import { WebSocket } from "ws";

const terminalController = new TerminalController();

// Track WebSocket clients subscribed to terminal sessions
const terminalClients = new Map<string, Set<WebSocket>>();

export function createTerminalControlRouter(): Router {
  const router = Router();

  // ============================================
  // Session Management
  // ============================================

  /** Create a new terminal session */
  router.post("/sessions", (req: Request, res: Response) => {
    try {
      const { cwd, env } = req.body;
      const sessionId = terminalController.createSession(cwd, env);

      // Set up output streaming
      terminalController.on("command:output", (data) => {
        if (data.sessionId === sessionId) {
          broadcastTerminalOutput(sessionId, {
            type: "output",
            commandId: data.commandId,
            stream: data.stream,
            chunk: data.chunk,
            timestamp: Date.now(),
          });
        }
      });

      terminalController.on("command:complete", (data) => {
        if (data.sessionId === sessionId) {
          broadcastTerminalOutput(sessionId, {
            type: "complete",
            commandId: data.commandId,
            result: data.result,
            timestamp: Date.now(),
          });
        }
      });

      res.json({
        sessionId,
        cwd: terminalController.getCwd(sessionId),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a terminal session */
  router.delete("/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      terminalController.closeSession(req.params.sessionId);
      terminalClients.delete(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get session info */
  router.get("/sessions/:sessionId", (req: Request, res: Response) => {
    try {
      const cwd = terminalController.getCwd(req.params.sessionId);
      const history = terminalController.getHistory(req.params.sessionId, 10);
      res.json({
        sessionId: req.params.sessionId,
        cwd,
        recentHistory: history.map((h) => ({
          id: h.id,
          command: h.command,
          exitCode: h.exitCode,
          success: h.success,
          duration: h.duration,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Command Execution
  // ============================================

  /** Execute a command */
  router.post("/sessions/:sessionId/exec", async (req: Request, res: Response) => {
    try {
      const { 
        command, 
        args, 
        cwd, 
        env, 
        timeout, 
        shell, 
        stream, 
        background,
        interactive,
        inDocker,
        dockerImage,
        confirmDangerous
      } = req.body;

      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }

      // Safety check before execution
      const safety = terminalController.isCommandSafe(command);
      if (!safety.safe && !confirmDangerous) {
        return res.status(403).json({
          error: "Command blocked by safety policy",
          reason: safety.reason,
          severity: safety.severity,
          requiresConfirmation: true
        });
      }

      const request: CommandRequest = {
        command,
        args,
        cwd,
        env,
        timeout: timeout || 30000,
        shell: shell || "bash",
        stream: stream !== false, // Stream by default
        background,
        interactive,
        inDocker,
        dockerImage,
        confirmDangerous
      };

      const result = await terminalController.executeCommand(req.params.sessionId, request);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Check if a command is safe */
  router.post("/sessions/:sessionId/check-safety", (req: Request, res: Response) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }
      const result = terminalController.isCommandSafe(command);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // File System Operations
  // ============================================

  /** Perform a file operation */
  router.post("/sessions/:sessionId/file", async (req: Request, res: Response) => {
    try {
      const { type, path, destination, content, pattern, recursive, permissions } = req.body;

      if (!type || !path) {
        return res.status(400).json({ error: "type and path are required" });
      }

      const op: FileOperation = {
        type,
        path,
        destination,
        content,
        pattern,
        recursive,
        permissions,
      };

      const result = await terminalController.fileOperation(req.params.sessionId, op);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // System Information
  // ============================================

  /** Get system information */
  router.get("/system-info", async (_req: Request, res: Response) => {
    try {
      const info = await terminalController.getSystemInfo();
      res.json(info);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Process Management
  // ============================================

  /** List running processes */
  router.get("/processes", async (req: Request, res: Response) => {
    try {
      const filter = req.query.filter as string | undefined;
      const processes = await terminalController.listProcesses(filter);
      res.json({ processes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Kill a process */
  router.post("/processes/:pid/kill", async (req: Request, res: Response) => {
    try {
      const pid = parseInt(req.params.pid, 10);
      const signal = req.body.signal || "SIGTERM";
      const success = await terminalController.killProcess(pid, signal);
      res.json({ success });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Port Management
  // ============================================

  /** List listening ports */
  router.get("/ports", async (_req: Request, res: Response) => {
    try {
      const ports = await terminalController.listPorts();
      res.json({ ports });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Package Management
  // ============================================

  /** Install packages */
  router.post("/sessions/:sessionId/packages", async (req: Request, res: Response) => {
    try {
      const { manager, packages } = req.body;
      if (!manager || !packages || !Array.isArray(packages)) {
        return res.status(400).json({ error: "manager and packages array are required" });
      }
      const result = await terminalController.installPackage(
        req.params.sessionId,
        manager,
        packages
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Script Execution
  // ============================================

  /** Execute a script in a given language */
  router.post("/sessions/:sessionId/script", async (req: Request, res: Response) => {
    try {
      const { language, code, timeout, args } = req.body;
      if (!language || !code) {
        return res.status(400).json({ error: "language and code are required" });
      }
      const result = await terminalController.executeScript(req.params.sessionId, language, code, {
        timeout,
        args,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // History
  // ============================================

  /** Get command history */
  router.get("/sessions/:sessionId/history", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const history = terminalController.getHistory(req.params.sessionId, limit);
      res.json({ history });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Replay a command from history */
  router.post("/sessions/:sessionId/replay/:commandId", async (req: Request, res: Response) => {
    try {
      const result = await terminalController.replayCommand(
        req.params.sessionId,
        req.params.commandId
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Environment Management
  // ============================================

  /** Get environment variables for a session */
  router.get("/sessions/:sessionId/env", async (req: Request, res: Response) => {
    try {
      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: "env",
        timeout: 5000,
        shell: "bash",
        stream: false,
      });
      const envVars: Record<string, string> = {};
      if (result.stdout) {
        for (const line of result.stdout.split("\n")) {
          const eqIdx = line.indexOf("=");
          if (eqIdx > 0) {
            envVars[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
          }
        }
      }
      res.json({ env: envVars, count: Object.keys(envVars).length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set environment variables for a session */
  router.post("/sessions/:sessionId/env", async (req: Request, res: Response) => {
    try {
      const { variables } = req.body;
      if (!variables || typeof variables !== "object") {
        return res.status(400).json({ error: "variables object is required" });
      }

      const exports = Object.entries(variables)
        .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
        .join(" && ");

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: exports,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      res.json({ set: Object.keys(variables).length, success: result.success });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Load dotfile (.bashrc, .env, etc.) */
  router.post("/sessions/:sessionId/dotfile", async (req: Request, res: Response) => {
    try {
      const { path: dotfilePath, type } = req.body;
      if (!dotfilePath) {
        return res.status(400).json({ error: "path is required" });
      }

      let command: string;
      if (type === "env" || dotfilePath.endsWith(".env")) {
        // Parse .env file and export variables
        command = `set -a && source ${JSON.stringify(dotfilePath)} && set +a && echo "LOADED"`;
      } else {
        // Source shell config
        command = `source ${JSON.stringify(dotfilePath)} && echo "LOADED"`;
      }

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command,
        timeout: 10000,
        shell: "bash",
        stream: false,
      });

      res.json({
        loaded: result.stdout?.includes("LOADED") || false,
        path: dotfilePath,
        output: result.stdout,
        error: result.stderr || undefined,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get shell aliases */
  router.get("/sessions/:sessionId/aliases", async (req: Request, res: Response) => {
    try {
      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: "alias",
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      const aliases: Record<string, string> = {};
      if (result.stdout) {
        for (const line of result.stdout.split("\n")) {
          const match = line.match(/^alias\s+(\S+?)='(.+)'$/);
          if (match) {
            aliases[match[1]] = match[2];
          }
        }
      }

      res.json({ aliases, count: Object.keys(aliases).length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set shell aliases */
  router.post("/sessions/:sessionId/aliases", async (req: Request, res: Response) => {
    try {
      const { aliases } = req.body;
      if (!aliases || typeof aliases !== "object") {
        return res.status(400).json({ error: "aliases object is required" });
      }

      const commands = Object.entries(aliases)
        .map(([name, cmd]) => `alias ${name}=${JSON.stringify(cmd)}`)
        .join(" && ");

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: commands,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      res.json({ set: Object.keys(aliases).length, success: result.success });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Working Directory Management
  // ============================================

  /** Change working directory */
  router.post("/sessions/:sessionId/cd", async (req: Request, res: Response) => {
    try {
      const { path: targetPath } = req.body;
      if (!targetPath) {
        return res.status(400).json({ error: "path is required" });
      }

      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: `cd ${JSON.stringify(targetPath)} && pwd`,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      res.json({
        cwd: result.stdout?.trim() || targetPath,
        success: result.success,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** List directory contents with details */
  router.get("/sessions/:sessionId/ls", async (req: Request, res: Response) => {
    try {
      const dirPath = (req.query.path as string) || ".";
      const result = await terminalController.executeCommand(req.params.sessionId, {
        command: `ls -la ${JSON.stringify(dirPath)}`,
        timeout: 5000,
        shell: "bash",
        stream: false,
      });

      const entries: Array<{
        permissions: string;
        owner: string;
        group: string;
        size: string;
        modified: string;
        name: string;
        type: string;
      }> = [];

      if (result.stdout) {
        const lines = result.stdout.split("\n").filter((l) => l.trim() && !l.startsWith("total"));
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 9) {
            entries.push({
              permissions: parts[0],
              owner: parts[2],
              group: parts[3],
              size: parts[4],
              modified: `${parts[5]} ${parts[6]} ${parts[7]}`,
              name: parts.slice(8).join(" "),
              type: parts[0].startsWith("d") ? "directory" : parts[0].startsWith("l") ? "symlink" : "file",
            });
          }
        }
      }

      res.json({ path: dirPath, entries, count: entries.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Disk & Resource Monitoring
  // ============================================

  /** Get disk usage */
  router.get("/disk-usage", async (_req: Request, res: Response) => {
    try {
      const tempSession = terminalController.createSession();
      const result = await terminalController.executeCommand(tempSession, {
        command: "df -h --output=source,size,used,avail,pcent,target 2>/dev/null || df -h",
        timeout: 5000,
        shell: "bash",
        stream: false,
      });
      terminalController.closeSession(tempSession);

      const lines = result.stdout?.split("\n").filter((l) => l.trim()) || [];
      const header = lines[0] || "";
      const disks = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parts[4],
          mountpoint: parts[5],
        };
      });

      res.json({ disks });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get resource usage (CPU, Memory top processes) */
  router.get("/resource-usage", async (_req: Request, res: Response) => {
    try {
      const tempSession = terminalController.createSession();
      const result = await terminalController.executeCommand(tempSession, {
        command: 'ps aux --sort=-%mem | head -11',
        timeout: 5000,
        shell: "bash",
        stream: false,
      });
      terminalController.closeSession(tempSession);

      const lines = result.stdout?.split("\n").filter((l) => l.trim()) || [];
      const processes = lines.slice(1).map((line) => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0],
          pid: parts[1],
          cpu: parts[2],
          mem: parts[3],
          vsz: parts[4],
          rss: parts[5],
          command: parts.slice(10).join(" "),
        };
      });

      res.json({ topProcesses: processes });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

/** Broadcast terminal output to subscribed WebSocket clients */
function broadcastTerminalOutput(sessionId: string, message: any): void {
  const clients = terminalClients.get(sessionId);
  if (!clients) return;

  const payload = JSON.stringify({
    messageType: "terminal_event",
    sessionId,
    ...message,
  });

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

export { terminalController, terminalClients };

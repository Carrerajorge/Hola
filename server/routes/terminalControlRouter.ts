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
      const { command, args, cwd, env, timeout, shell, stream, background } = req.body;

      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }

      // Safety check before execution
      const safety = terminalController.isCommandSafe(command);
      if (!safety.safe) {
        return res.status(403).json({
          error: "Command blocked by safety policy",
          reason: safety.reason,
          severity: safety.severity,
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

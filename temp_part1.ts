/**
 * Advanced Computer Use LangChain Tools
 *
 * Extends the agent's capabilities with:
 * - Process management (list, kill)
 * - Script execution (multi-language)
 * - Package management (npm, pip, apt)
 * - PDF generation from browser pages
 * - Accessibility tree analysis
 * - Session recording & replay
 * - Workflow automation
 * - Scraping pipelines
 * - Performance metrics
 * - Element picker (visual)
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { terminalController } from "../terminalController";
import { universalBrowserController } from "../universalBrowserController";
import { browserEngineExtensions } from "../browserEngineExtensions";
import { workflowEngine } from "../workflowEngine";

// ============================================
// Terminal: Process Management
// ============================================

export const terminalProcessManageTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "list": {
          const processes = await terminalController.listProcesses(input.filter);
          return JSON.stringify({
            success: true,
            count: processes.length,
            processes: processes.slice(0, 30).map((p) => ({
              pid: p.pid,
              name: p.name,
              cpu: p.cpu,
              memory: p.memory,
              status: p.status,
            })),
          });
        }
        case "kill": {
          if (!input.pid) return JSON.stringify({ success: false, error: "PID required" });
          const killed = await terminalController.killProcess(input.pid, input.signal || "SIGTERM");
          return JSON.stringify({ success: killed, pid: input.pid, signal: input.signal || "SIGTERM" });
        }
        case "ports": {
          const ports = await terminalController.listPorts();
          return JSON.stringify({ success: true, ports });
        }
        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${input.action}` });
      }
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_process_manage",
    description: "Manage system processes: list running processes with CPU/memory usage, kill processes by PID, list listening network ports.",
    schema: z.object({
      action: z.enum(["list", "kill", "ports"]).describe("Action: list processes, kill a process, or list ports"),
      filter: z.string().optional().describe("Filter processes by name (for list action)"),
      pid: z.number().optional().describe("Process ID to kill"),
      signal: z.string().optional().default("SIGTERM").describe("Signal: SIGTERM, SIGKILL, SIGHUP"),
    }),
  }
);

// ============================================
// Terminal: Script Execution
// ============================================

export const terminalScriptExecuteTool = tool(
  async (input) => {
    try {
      const sid = input.sessionId || terminalController.createSession(input.cwd);
      const result = await terminalController.executeScript(sid, input.language, input.code, {
        timeout: input.timeout || 60000,
        args: input.args,
      });

      return JSON.stringify({
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 5000),
        stderr: result.stderr.slice(0, 2000),
        duration: result.duration,
        sessionId: sid,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_script_execute",
    description: "Execute a code script in any supported language: Python, JavaScript, TypeScript, Bash, Ruby, Go, PHP. Writes a temp file and runs it with the appropriate interpreter.",
    schema: z.object({
      language: z.enum(["python", "javascript", "typescript", "bash", "ruby", "go", "php"]).describe("Programming language"),
      code: z.string().describe("Source code to execute"),
      args: z.array(z.string()).optional().describe("Command-line arguments"),
      timeout: z.number().optional().default(60000).describe("Timeout in milliseconds"),
      cwd: z.string().optional().describe("Working directory"),
      sessionId: z.string().optional().describe("Reuse existing session"),
    }),
  }
);

// ============================================
// Terminal: Package Management
// ============================================

export const terminalPackageManageTool = tool(
  async (input) => {
    try {
      const sid = input.sessionId || terminalController.createSession();
      const result = await terminalController.installPackage(sid, input.manager, input.packages);

      return JSON.stringify({
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout.slice(0, 3000),
        stderr: result.stderr.slice(0, 1000),
        duration: result.duration,
        sessionId: sid,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "terminal_package_manage",
    description: "Install packages using npm, pip, or apt. Specify the package manager and list of packages to install.",
    schema: z.object({
      manager: z.enum(["npm", "pip", "apt"]).describe("Package manager"),
      packages: z.array(z.string()).describe("Package names to install"),
      sessionId: z.string().optional(),
    }),
  }
);

// ============================================
// Browser: PDF Generation
// ============================================

export const browserPdfGenerateTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);
      const { path: filePath } = await browserEngineExtensions.generatePdf(page, {
        format: input.format as any,
        landscape: input.landscape,
        printBackground: input.printBackground,
        scale: input.scale,
      });

      return JSON.stringify({
        success: true,
        filePath,
        format: input.format || "A4",
        landscape: input.landscape || false,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_pdf_generate",
    description: "Generate a PDF from the current browser page. Supports A4, Letter, Legal, A3, Tabloid formats with landscape mode, background printing, and custom scale.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      format: z.enum(["A4", "Letter", "Legal", "A3", "Tabloid"]).optional().default("A4"),
      landscape: z.boolean().optional().default(false),
      printBackground: z.boolean().optional().default(true),
      scale: z.number().optional().default(1).describe("Scale factor (0.1 to 2.0)"),
    }),
  }
);

// ============================================
// Browser: Accessibility
// ============================================

export const browserAccessibilityTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);

      if (input.role) {
        const nodes = await browserEngineExtensions.getAccessibilityByRole(page, input.role);
        return JSON.stringify({
          success: true,
          role: input.role,
          count: nodes.length,
          nodes: nodes.slice(0, 20).map((n) => ({
            name: n.name,
            value: n.value,
            disabled: n.disabled,
          })),
        });
      }

      const tree = await browserEngineExtensions.getAccessibilityTree(page);
      // Flatten to summary
      const flatNodes: any[] = [];
      function flatten(node: any, depth: number) {
        if (depth > 3) return;
        flatNodes.push({
          role: node.role,
          name: node.name?.slice(0, 100),
          depth,
        });
        if (node.children) {
          for (const child of node.children) flatten(child, depth + 1);
        }
      }
      flatten(tree, 0);

      return JSON.stringify({
        success: true,
        totalNodes: flatNodes.length,
        tree: flatNodes.slice(0, 50),
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_accessibility",
    description: "Get the accessibility tree or find elements by ARIA role. Useful for understanding page structure, finding interactive elements, and checking accessibility compliance.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      role: z.string().optional().describe("Filter by role: button, link, heading, textbox, checkbox, radio, etc."),
    }),
  }
);

// ============================================
// Browser: Performance Metrics
// ============================================

export const browserPerformanceTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);
      const metrics = await browserEngineExtensions.getPerformanceMetrics(page);

      return JSON.stringify({
        success: true,
        metrics: {
          loadTime: `${Math.round(metrics.loadTime)}ms`,
          domContentLoaded: `${Math.round(metrics.domContentLoaded)}ms`,
          firstPaint: `${Math.round(metrics.firstPaint)}ms`,
          firstContentfulPaint: `${Math.round(metrics.firstContentfulPaint)}ms`,
          largestContentfulPaint: `${Math.round(metrics.largestContentfulPaint)}ms`,
          cumulativeLayoutShift: metrics.cumulativeLayoutShift.toFixed(3),
          domNodes: metrics.domNodes,
          resources: metrics.resourceCount,
          transferSize: `${Math.round(metrics.transferSize / 1024)}KB`,
          jsHeapSize: `${Math.round(metrics.jsHeapSize / 1024 / 1024)}MB`,
        },
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_performance",
    description: "Get web performance metrics: load time, FCP, LCP, CLS, DOM nodes, resource count, JS heap size. Useful for performance auditing and optimization.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
    }),
  }
);

// ============================================
// Browser: Element Picker
// ============================================

export const browserElementPickerTool = tool(
  async (input) => {
    try {
      const page = universalBrowserController.getActivePage(input.sessionId);

      if (input.action === "highlight") {
        const screenshot = await browserEngineExtensions.highlightElements(page, input.highlights || []);
        return JSON.stringify({
          success: true,
          screenshot: screenshot.slice(0, 200) + "...[truncated]",
          screenshotLength: screenshot.length,
          highlightCount: input.highlights?.length || 0,
        });
      }

      if (input.action === "pick" && input.x !== undefined && input.y !== undefined) {
        const element = await browserEngineExtensions.getElementAtPoint(page, input.x, input.y);
        return JSON.stringify({
          success: true,
          element: element || null,
        });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_element_picker",
    description: "Interact with page elements visually. 'pick' identifies the element at given coordinates (x,y) and returns its CSS selector. 'highlight' draws colored borders around specified elements and returns a screenshot.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["pick", "highlight"]).describe("pick: identify element at coordinates; highlight: draw borders on elements"),
      x: z.number().optional().describe("X coordinate for pick"),
      y: z.number().optional().describe("Y coordinate for pick"),
      highlights: z.array(z.object({
        selector: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
      })).optional().describe("Elements to highlight"),
    }),
  }
);

// ============================================
// Browser: Console Capture
// ============================================

export const browserConsoleTool = tool(
  async (input) => {
    try {
      if (input.action === "start") {
        const page = universalBrowserController.getActivePage(input.sessionId);
        browserEngineExtensions.startConsoleCapture(input.sessionId, page);
        return JSON.stringify({ success: true, message: "Console capture started" });
      }

      if (input.action === "get") {
        const entries = browserEngineExtensions.getConsoleEntries(input.sessionId, {
          type: input.filter as any,
          limit: input.limit || 50,
        });
        return JSON.stringify({
          success: true,
          count: entries.length,
          entries: entries.map((e) => ({
            type: e.type,
            text: e.text.slice(0, 500),
            timestamp: e.timestamp,
          })),
        });
      }

      if (input.action === "clear") {
        browserEngineExtensions.clearConsoleEntries(input.sessionId);
        return JSON.stringify({ success: true, message: "Console cleared" });
      }

      return JSON.stringify({ success: false, error: "Invalid action" });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },
  {
    name: "browser_console",
    description: "Capture and inspect browser console output (logs, errors, warnings). Start capture, then retrieve entries filtered by type.",
    schema: z.object({
      sessionId: z.string().describe("Browser session ID"),
      action: z.enum(["start", "get", "clear"]).describe("start: begin capture; get: retrieve logs; clear: reset"),
      filter: z.enum(["log", "error", "warning", "info"]).optional().describe("Filter by console type"),
      limit: z.number().optional().default(50).describe("Max entries to return"),
    }),
  }
);

// ============================================
// Browser: Session Recording
// ============================================

export const browserRecordingTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "start": {
          const page = universalBrowserController.getActivePage(input.sessionId);
          const recordingId = browserEngineExtensions.startRecording(
            input.sessionId,
            input.name || "Recording",
            page.url(),
            "chrome-desktop"
          );
          return JSON.stringify({ success: true, recordingId });
        }
        case "stop": {
          const recording = browserEngineExtensions.stopRecording(input.sessionId);
          return JSON.stringify({

/**
 * Computer Use API Routes
 *
 * Unified REST API for all computer control capabilities:
 * - /api/computer-use/session - Session management
 * - /api/computer-use/screen - Screenshot and vision
 * - /api/computer-use/mouse - Mouse control
 * - /api/computer-use/keyboard - Keyboard control
 * - /api/computer-use/browser - Browser automation
 * - /api/computer-use/terminal - Terminal/shell execution
 * - /api/computer-use/generate/ppt - Presentation generation
 * - /api/computer-use/generate/doc - Document generation
 * - /api/computer-use/generate/excel - Spreadsheet generation
 * - /api/computer-use/vision - Computer vision analysis
 * - /api/computer-use/agent - Autonomous agent execution
 * - /api/computer-use/task - Agentic task execution
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
  computerUseEngine,
  universalBrowserController,
  autonomousAgentBrain,
  perfectPptGenerator,
  perfectDocumentGenerator,
  perfectExcelGenerator,
  terminalController,
  visionPipeline,
} from "../agent/computerUse";

const router = Router();

// ============================================
// Helper: Validation wrapper
// ============================================

function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

function handleError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  res.status(400).json({ success: false, error: message });
}

// ============================================
// SESSION MANAGEMENT
// ============================================

router.post("/session/create", async (req: Request, res: Response) => {
  try {
    const { mode = "browser", viewport, userAgent, locale } = req.body;
    const sessionId = await computerUseEngine.createSession(mode, { viewport, userAgent, locale });
    res.json({ success: true, sessionId, mode });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/session/close", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    await computerUseEngine.closeSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// SCREEN CONTROL
// ============================================

router.post("/screen/screenshot", async (req: Request, res: Response) => {
  try {
    const { sessionId, fullPage, region, quality } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    const screenshot = await computerUseEngine.captureScreenshot(sessionId, { fullPage, region, quality });
    res.json({ success: true, screenshot, format: "base64/png" });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/screen/analyze", async (req: Request, res: Response) => {
  try {
    const { sessionId, query } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    const analysis = await computerUseEngine.analyzeScreen(sessionId, query);
    res.json({ success: true, analysis });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// MOUSE CONTROL
// ============================================

router.post("/mouse/click", async (req: Request, res: Response) => {
  try {
    const { sessionId, x, y, button, clickCount, delay } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (x == null || y == null) return res.status(400).json({ success: false, error: "x and y coordinates are required" });
    const result = await computerUseEngine.mouseClick(sessionId, { x, y }, { button, clickCount, delay });
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/mouse/drag", async (req: Request, res: Response) => {
  try {
    const { sessionId, fromX, fromY, toX, toY } = req.body;
    const result = await computerUseEngine.mouseDrag(sessionId, { x: fromX, y: fromY }, { x: toX, y: toY });
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/mouse/scroll", async (req: Request, res: Response) => {
  try {
    const { sessionId, x, y, deltaX = 0, deltaY = 0 } = req.body;
    const result = await computerUseEngine.mouseScroll(sessionId, { x, y }, { x: deltaX, y: deltaY });
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// KEYBOARD CONTROL
// ============================================

router.post("/keyboard/type", async (req: Request, res: Response) => {
  try {
    const { sessionId, text, delay } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!text && text !== "") return res.status(400).json({ success: false, error: "text is required" });
    const result = await computerUseEngine.typeText(sessionId, text, { delay });
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/keyboard/press", async (req: Request, res: Response) => {
  try {
    const { sessionId, key, modifiers } = req.body;
    const result = await computerUseEngine.pressKey(sessionId, key, modifiers);
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/keyboard/hotkey", async (req: Request, res: Response) => {
  try {
    const { sessionId, keys } = req.body;
    const result = await computerUseEngine.hotkey(sessionId, keys);
    res.json({ success: true, result });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// BROWSER AUTOMATION
// ============================================

router.post("/browser/create-session", async (req: Request, res: Response) => {
  try {
    const { profileId = "chrome-desktop", customProfile } = req.body;
    const sessionId = await universalBrowserController.createSession(profileId, customProfile);
    res.json({ success: true, sessionId, profileId });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/navigate", async (req: Request, res: Response) => {
  try {
    const { sessionId, url, waitUntil, timeout } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!url) return res.status(400).json({ success: false, error: "url is required" });
    const result = await universalBrowserController.navigate(sessionId, url, { waitUntil, timeout });
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/click", async (req: Request, res: Response) => {
  try {
    const { sessionId, selector, button, clickCount, timeout, force } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!selector) return res.status(400).json({ success: false, error: "selector is required" });
    const result = await universalBrowserController.click(sessionId, selector, { button, clickCount, timeout, force });
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/type", async (req: Request, res: Response) => {
  try {
    const { sessionId, selector, text, clear, delay, pressEnter } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!selector) return res.status(400).json({ success: false, error: "selector is required" });
    const result = await universalBrowserController.type(sessionId, selector, text || "", { clear, delay, pressEnter });
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/extract", async (req: Request, res: Response) => {
  try {
    const { sessionId, rules } = req.body;
    const data = await universalBrowserController.extract(sessionId, rules);
    res.json({ success: true, data });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/extract-structured", async (req: Request, res: Response) => {
  try {
    const { sessionId, description } = req.body;
    const data = await universalBrowserController.extractStructured(sessionId, description);
    res.json({ success: true, data });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/screenshot", async (req: Request, res: Response) => {
  try {
    const { sessionId, fullPage, selector, quality } = req.body;
    const screenshot = await universalBrowserController.screenshot(sessionId, { fullPage, selector, quality });
    res.json({ success: true, screenshot, format: "base64/png" });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/agentic-navigate", async (req: Request, res: Response) => {
  try {
    const { sessionId, goal, maxSteps } = req.body;
    const result = await universalBrowserController.agenticNavigate(sessionId, goal, maxSteps);
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/execute-task", async (req: Request, res: Response) => {
  try {
    const { sessionId, task } = req.body;
    const result = await universalBrowserController.executeAgenticTask(sessionId, task);
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/browser/tabs/:sessionId", async (req: Request, res: Response) => {
  try {
    const tabs = universalBrowserController.listTabs(req.params.sessionId);
    res.json({ success: true, tabs });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/new-tab", async (req: Request, res: Response) => {
  try {
    const { sessionId, url } = req.body;
    const tabId = await universalBrowserController.newTab(sessionId, url);
    res.json({ success: true, tabId });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/cookies", async (req: Request, res: Response) => {
  try {
    const { sessionId, action, cookies, urls } = req.body;
    if (action === "get") {
      const data = await universalBrowserController.getCookies(sessionId, urls);
      res.json({ success: true, cookies: data });
    } else if (action === "set") {
      await universalBrowserController.setCookies(sessionId, cookies);
      res.json({ success: true });
    } else if (action === "clear") {
      await universalBrowserController.clearCookies(sessionId);
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: `Unknown cookie action: ${action}` });
    }
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/browser/close-session", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    await universalBrowserController.closeSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// TERMINAL CONTROL
// ============================================

router.post("/terminal/create-session", async (req: Request, res: Response) => {
  try {
    const { cwd, env } = req.body;
    const sessionId = terminalController.createSession(cwd, env);
    res.json({ success: true, sessionId });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/terminal/execute", async (req: Request, res: Response) => {
  try {
    const { sessionId, command, args, cwd, timeout, shell } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!command) return res.status(400).json({ success: false, error: "command is required" });
    const result = await terminalController.executeCommand(sessionId, { command, args, cwd, timeout, shell });
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/terminal/execute-script", async (req: Request, res: Response) => {
  try {
    const { sessionId, language, code, timeout, args } = req.body;
    const result = await terminalController.executeScript(sessionId, language, code, { timeout, args });
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/terminal/file-operation", async (req: Request, res: Response) => {
  try {
    const { sessionId, operation } = req.body;
    const result = await terminalController.fileOperation(sessionId, operation);
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/terminal/system-info", async (_req: Request, res: Response) => {
  try {
    const info = await terminalController.getSystemInfo();
    res.json({ success: true, info });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/terminal/processes", async (req: Request, res: Response) => {
  try {
    const filter = req.query.filter as string | undefined;
    const processes = await terminalController.listProcesses(filter);
    res.json({ success: true, processes });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/terminal/ports", async (_req: Request, res: Response) => {
  try {
    const ports = await terminalController.listPorts();
    res.json({ success: true, ports });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/terminal/history/:sessionId", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = terminalController.getHistory(req.params.sessionId, limit);
    res.json({ success: true, history });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/terminal/close-session", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    terminalController.closeSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// DOCUMENT GENERATION
// ============================================

router.post("/generate/ppt", async (req: Request, res: Response) => {
  try {
    const request = req.body;
    const result = await perfectPptGenerator.generate(request);

    res.json({
      success: true,
      id: result.id,
      fileName: result.fileName,
      slideCount: result.slideCount,
      outline: result.outline,
      metadata: result.metadata,
      // Send buffer as base64 for download
      buffer: result.buffer.toString("base64"),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/generate/ppt/download", async (req: Request, res: Response) => {
  try {
    const result = await perfectPptGenerator.generate(req.body);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.send(result.buffer);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/generate/ppt/templates", (_req: Request, res: Response) => {
  const templates = perfectPptGenerator.getAvailableTemplates();
  res.json({ success: true, templates });
});

router.post("/generate/doc", async (req: Request, res: Response) => {
  try {
    const result = await perfectDocumentGenerator.generate(req.body);

    res.json({
      success: true,
      id: result.id,
      fileName: result.fileName,
      wordCount: result.wordCount,
      sectionCount: result.sectionCount,
      metadata: result.metadata,
      buffer: result.buffer.toString("base64"),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/generate/doc/download", async (req: Request, res: Response) => {
  try {
    const result = await perfectDocumentGenerator.generate(req.body);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.send(result.buffer);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/generate/doc/templates", (_req: Request, res: Response) => {
  const templates = perfectDocumentGenerator.getAvailableTemplates();
  res.json({ success: true, templates });
});

router.post("/generate/excel", async (req: Request, res: Response) => {
  try {
    const result = await perfectExcelGenerator.generate(req.body);

    res.json({
      success: true,
      id: result.id,
      fileName: result.fileName,
      sheetCount: result.sheetCount,
      totalRows: result.totalRows,
      metadata: result.metadata,
      buffer: result.buffer.toString("base64"),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/generate/excel/download", async (req: Request, res: Response) => {
  try {
    const result = await perfectExcelGenerator.generate(req.body);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    res.send(result.buffer);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/generate/excel/templates", (_req: Request, res: Response) => {
  const templates = perfectExcelGenerator.getAvailableTemplates();
  res.json({ success: true, templates });
});

// ============================================
// COMPUTER VISION
// ============================================

router.post("/vision/analyze", async (req: Request, res: Response) => {
  try {
    const { image, query, mode = "analyze", previousImage, targetDescription, options } = req.body;
    const result = await visionPipeline.analyze({
      image, query, mode, previousImage, targetDescription, options,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/vision/ocr", async (req: Request, res: Response) => {
  try {
    const { image, query } = req.body;
    const result = await visionPipeline.analyze({ image, query: query || "Extract all text", mode: "ocr" });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/vision/detect-elements", async (req: Request, res: Response) => {
  try {
    const { image } = req.body;
    const result = await visionPipeline.analyze({ image, query: "Detect all elements", mode: "detect_elements" });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/vision/find-element", async (req: Request, res: Response) => {
  try {
    const { image, description } = req.body;
    const result = await visionPipeline.analyze({
      image, query: description, mode: "find_element", targetDescription: description,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/vision/accessibility", async (req: Request, res: Response) => {
  try {
    const { image } = req.body;
    const result = await visionPipeline.analyze({ image, query: "Analyze accessibility", mode: "accessibility" });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// AUTONOMOUS AGENT
// ============================================

router.post("/agent/execute-goal", async (req: Request, res: Response) => {
  try {
    const { goal, context } = req.body;
    if (!goal?.description) return res.status(400).json({ success: false, error: "goal.description is required" });

    // Ensure goal has required fields
    const agentGoal = {
      id: goal.id || `goal-${Date.now()}`,
      description: goal.description,
      priority: goal.priority || "medium",
      category: goal.category || "mixed",
      constraints: {
        maxDuration: goal.constraints?.maxDuration || 300000,
        maxActions: goal.constraints?.maxActions || 30,
        maxCost: goal.constraints?.maxCost || 1.0,
        requireConfirmation: goal.constraints?.requireConfirmation ?? false,
        allowedTools: goal.constraints?.allowedTools || [],
        blockedTools: goal.constraints?.blockedTools || [],
        safetyLevel: goal.constraints?.safetyLevel || "moderate",
      },
      successCriteria: goal.successCriteria || [`Complete: ${goal.description}`],
    };

    const agentContext = {
      userId: context?.userId || "anonymous",
      sessionId: context?.sessionId || `session-${Date.now()}`,
      conversationHistory: context?.conversationHistory || [],
      availableTools: context?.availableTools || [],
      userPreferences: context?.userPreferences || {},
      environmentInfo: context?.environmentInfo || {},
    };

    const result = await autonomousAgentBrain.executeGoal(agentGoal, agentContext);
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/agent/decompose-goal", async (req: Request, res: Response) => {
  try {
    const { goal, context } = req.body;
    const subGoals = await autonomousAgentBrain.decomposeGoal(goal, context);
    res.json({ success: true, subGoals });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/agent/suggest-tasks", async (req: Request, res: Response) => {
  try {
    const { context } = req.body;
    const tasks = await autonomousAgentBrain.generateProactiveTasks(context);
    res.json({ success: true, tasks });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/agent/state", (_req: Request, res: Response) => {
  res.json({
    success: true,
    state: autonomousAgentBrain.getState(),
    thoughts: autonomousAgentBrain.getThoughts().slice(-10),
  });
});

// ============================================
// AUTONOMOUS TASK EXECUTION (Computer Use)
// ============================================

router.post("/task/execute", async (req: Request, res: Response) => {
  try {
    const { sessionId, goal } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    if (!goal?.description) return res.status(400).json({ success: false, error: "goal.description is required" });

    const taskGoal = {
      description: goal.description,
      steps: goal.steps || [goal.description],
      successCriteria: goal.successCriteria || [],
      maxAttempts: goal.maxAttempts || 10,
      timeout: goal.timeout || 120000,
    };

    const result = await computerUseEngine.executeTask(sessionId, taskGoal);
    res.json({ ...result, success: true });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================
// CAPABILITIES ENDPOINT
// ============================================

router.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    success: true,
    version: "2.0.0",
    capabilities: {
      computerUse: {
        description: "Full screen control with vision (Anthropic Computer Use-style)",
        features: ["screenshot", "mouse_click", "mouse_drag", "mouse_scroll", "keyboard_type", "keyboard_press", "hotkeys", "screen_analysis", "task_execution"],
      },
      browserControl: {
        description: "Multi-browser agentic automation",
        features: ["multi_browser", "multi_tab", "navigation", "click", "type", "extract", "screenshot", "cookies", "network_intercept", "agentic_navigate", "stealth_mode"],
        browsers: ["chromium", "firefox", "webkit"],
        profiles: ["chrome-desktop", "firefox-desktop", "safari-desktop", "mobile-iphone", "mobile-android"],
      },
      autonomousAgent: {
        description: "Self-initiative AI agent with ReAct loop",
        features: ["goal_decomposition", "self_planning", "self_reflection", "learning", "proactive_tasks", "safety_checks", "backtracking"],
      },
      documentGeneration: {
        ppt: {
          description: "AI-driven professional presentations",
          templates: perfectPptGenerator.getAvailableTemplates(),
          features: ["ai_content", "charts", "timelines", "comparisons", "infographics", "speaker_notes", "15_templates"],
        },
        doc: {
          description: "AI-driven professional documents",
          templates: perfectDocumentGenerator.getAvailableTemplates(),
          features: ["ai_content", "toc", "cover_page", "tables", "code_blocks", "references", "citations"],
          types: ["report", "letter", "essay", "thesis", "contract", "proposal", "memo", "manual", "article", "whitepaper"],
        },
        excel: {
          description: "AI-driven professional spreadsheets",
          templates: perfectExcelGenerator.getAvailableTemplates(),
          features: ["ai_data", "formulas", "conditional_formatting", "pivot_summary", "charts", "auto_styling"],
          types: ["spreadsheet", "dashboard", "financial_model", "report", "tracker", "database", "analysis", "budget", "invoice"],
        },
      },
      terminalControl: {
        description: "Full OS command execution",
        features: ["command_exec", "file_operations", "process_management", "port_management", "script_execution", "package_management", "system_info", "safety_guards"],
      },
      computerVision: {
        description: "Screen reading, OCR, element detection",
        features: ["screen_analysis", "ocr", "element_detection", "visual_search", "screen_comparison", "accessibility_analysis"],
      },
    },
  });
});

export default router;

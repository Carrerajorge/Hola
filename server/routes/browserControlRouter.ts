/**
 * Browser Control Router - Universal Multi-Browser Automation API
 *
 * Integrates the UniversalBrowserController to provide full control
 * over Chromium, Firefox, and WebKit browsers via REST endpoints.
 *
 * Features:
 * - Multi-browser session management (Chrome, Firefox, Safari, Mobile)
 * - Tab management (create, switch, close, list)
 * - Navigation with configurable wait strategies
 * - DOM interaction (click, type, scroll, select, hover, upload)
 * - Data extraction (CSS selectors, structured LLM-based)
 * - Screenshot capture (full page, element-level)
 * - Network interception and logging
 * - Cookie and localStorage management
 * - Agentic task execution (multi-step automation)
 * - LLM-powered autonomous navigation
 */

import { Router, Request, Response } from "express";
import {
  UniversalBrowserController,
  BrowserProfile,
  ExtractionRule,
  AgenticTask,
  AgenticStep,
} from "../agent/computerUse/universalBrowserController";

const browserController = new UniversalBrowserController();

export function createBrowserControlRouter(): Router {
  const router = Router();

  // ============================================
  // Profile Management
  // ============================================

  /** List available browser profiles */
  router.get("/profiles", (_req: Request, res: Response) => {
    const profiles = [
      { id: "chrome-desktop", name: "Chrome Desktop", browser: "chromium", viewport: "1920x1080" },
      { id: "firefox-desktop", name: "Firefox Desktop", browser: "firefox", viewport: "1920x1080" },
      { id: "safari-desktop", name: "Safari Desktop", browser: "webkit", viewport: "1440x900" },
      { id: "mobile-iphone", name: "iPhone Safari", browser: "webkit", viewport: "390x844" },
      { id: "mobile-android", name: "Android Chrome", browser: "chromium", viewport: "412x915" },
    ];
    res.json({ profiles });
  });

  // ============================================
  // Session Management
  // ============================================

  /** Create a new browser session */
  router.post("/sessions", async (req: Request, res: Response) => {
    try {
      const { profileId, customProfile } = req.body;
      const sessionId = await browserController.createSession(
        profileId || "chrome-desktop",
        customProfile
      );
      res.json({ sessionId, profileId: profileId || "chrome-desktop" });
    } catch (error: any) {
      console.error("[BrowserControl] Failed to create session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a browser session */
  router.delete("/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      await browserController.closeSession(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Tab Management
  // ============================================

  /** List all tabs in a session */
  router.get("/sessions/:sessionId/tabs", (req: Request, res: Response) => {
    try {
      const tabs = browserController.listTabs(req.params.sessionId);
      res.json({ tabs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Open a new tab */
  router.post("/sessions/:sessionId/tabs", async (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      const tabId = await browserController.newTab(req.params.sessionId, url);
      res.json({ tabId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Switch to a tab */
  router.post("/sessions/:sessionId/tabs/:tabId/activate", async (req: Request, res: Response) => {
    try {
      await browserController.switchTab(req.params.sessionId, req.params.tabId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Close a tab */
  router.delete("/sessions/:sessionId/tabs/:tabId", async (req: Request, res: Response) => {
    try {
      await browserController.closeTab(req.params.sessionId, req.params.tabId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Navigation
  // ============================================

  /** Navigate to a URL */
  router.post("/sessions/:sessionId/navigate", async (req: Request, res: Response) => {
    try {
      const { url, waitUntil, timeout, tabId } = req.body;
      if (!url) {
        return res.status(400).json({ error: "url is required" });
      }
      const result = await browserController.navigate(req.params.sessionId, url, {
        waitUntil,
        timeout,
        tabId,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Go back */
  router.post("/sessions/:sessionId/back", async (req: Request, res: Response) => {
    try {
      await browserController.goBack(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Go forward */
  router.post("/sessions/:sessionId/forward", async (req: Request, res: Response) => {
    try {
      await browserController.goForward(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Reload page */
  router.post("/sessions/:sessionId/reload", async (req: Request, res: Response) => {
    try {
      await browserController.reload(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Interaction
  // ============================================

  /** Click on an element */
  router.post("/sessions/:sessionId/click", async (req: Request, res: Response) => {
    try {
      const { selector, button, clickCount, timeout, force } = req.body;
      if (!selector) {
        return res.status(400).json({ error: "selector is required" });
      }
      const result = await browserController.click(req.params.sessionId, selector, {
        button,
        clickCount,
        timeout,
        force,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Type text into an element */
  router.post("/sessions/:sessionId/type", async (req: Request, res: Response) => {
    try {
      const { selector, text, clear, delay, pressEnter } = req.body;
      if (!selector || text === undefined) {
        return res.status(400).json({ error: "selector and text are required" });
      }
      const result = await browserController.type(req.params.sessionId, selector, text, {
        clear,
        delay,
        pressEnter,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Select option(s) from a dropdown */
  router.post("/sessions/:sessionId/select", async (req: Request, res: Response) => {
    try {
      const { selector, values } = req.body;
      if (!selector || !values) {
        return res.status(400).json({ error: "selector and values are required" });
      }
      const result = await browserController.select(req.params.sessionId, selector, values);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Hover over an element */
  router.post("/sessions/:sessionId/hover", async (req: Request, res: Response) => {
    try {
      const { selector } = req.body;
      if (!selector) {
        return res.status(400).json({ error: "selector is required" });
      }
      await browserController.hover(req.params.sessionId, selector);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Scroll the page or element */
  router.post("/sessions/:sessionId/scroll", async (req: Request, res: Response) => {
    try {
      const { direction, amount, selector } = req.body;
      await browserController.scroll(req.params.sessionId, {
        direction: direction || "down",
        amount,
        selector,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Upload file(s) */
  router.post("/sessions/:sessionId/upload", async (req: Request, res: Response) => {
    try {
      const { selector, filePaths } = req.body;
      if (!selector || !filePaths) {
        return res.status(400).json({ error: "selector and filePaths are required" });
      }
      await browserController.uploadFile(
        req.params.sessionId,
        selector,
        Array.isArray(filePaths) ? filePaths : [filePaths]
      );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Data Extraction
  // ============================================

  /** Extract data using CSS selector rules */
  router.post("/sessions/:sessionId/extract", async (req: Request, res: Response) => {
    try {
      const { rules } = req.body;
      if (!rules || !Array.isArray(rules)) {
        return res.status(400).json({ error: "rules array is required" });
      }
      const data = await browserController.extract(req.params.sessionId, rules as ExtractionRule[]);
      res.json({ data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Extract structured data using LLM */
  router.post("/sessions/:sessionId/extract-structured", async (req: Request, res: Response) => {
    try {
      const { description } = req.body;
      if (!description) {
        return res.status(400).json({ error: "description is required" });
      }
      const data = await browserController.extractStructured(req.params.sessionId, description);
      res.json({ data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Screenshot
  // ============================================

  /** Capture a screenshot */
  router.get("/sessions/:sessionId/screenshot", async (req: Request, res: Response) => {
    try {
      const fullPage = req.query.fullPage === "true";
      const selector = req.query.selector as string | undefined;
      const type = (req.query.type as "png" | "jpeg") || "png";
      const screenshot = await browserController.screenshot(req.params.sessionId, {
        fullPage,
        selector,
        type,
      });
      res.json({ screenshot: `data:image/${type};base64,${screenshot}` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Network
  // ============================================

  /** Set up network request interception */
  router.post("/sessions/:sessionId/intercept", async (req: Request, res: Response) => {
    try {
      const { patterns } = req.body;
      if (!patterns || !Array.isArray(patterns)) {
        return res.status(400).json({ error: "patterns array is required" });
      }
      await browserController.interceptRequests(req.params.sessionId, patterns);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get network logs */
  router.get("/sessions/:sessionId/network", (req: Request, res: Response) => {
    try {
      const urlPattern = req.query.urlPattern as string | undefined;
      const method = req.query.method as string | undefined;
      const logs = browserController.getNetworkLogs(req.params.sessionId, {
        urlPattern,
        method,
      });
      res.json({ logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Cookies & Storage
  // ============================================

  /** Get cookies */
  router.get("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      const urls = req.query.urls ? (req.query.urls as string).split(",") : undefined;
      const cookies = await browserController.getCookies(req.params.sessionId, urls);
      res.json({ cookies });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set cookies */
  router.post("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      const { cookies } = req.body;
      if (!cookies || !Array.isArray(cookies)) {
        return res.status(400).json({ error: "cookies array is required" });
      }
      await browserController.setCookies(req.params.sessionId, cookies);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Clear cookies */
  router.delete("/sessions/:sessionId/cookies", async (req: Request, res: Response) => {
    try {
      await browserController.clearCookies(req.params.sessionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Get localStorage */
  router.get("/sessions/:sessionId/storage", async (req: Request, res: Response) => {
    try {
      const items = await browserController.getLocalStorage(req.params.sessionId);
      res.json({ items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Set localStorage items */
  router.post("/sessions/:sessionId/storage", async (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      if (!items || typeof items !== "object") {
        return res.status(400).json({ error: "items object is required" });
      }
      await browserController.setLocalStorage(req.params.sessionId, items);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Agentic Automation
  // ============================================

  /** Execute a multi-step agentic task */
  router.post("/sessions/:sessionId/task", async (req: Request, res: Response) => {
    try {
      const { task } = req.body;
      if (!task || !task.steps) {
        return res.status(400).json({ error: "task with steps is required" });
      }

      const agenticTask: AgenticTask = {
        id: task.id || crypto.randomUUID(),
        name: task.name || "Automated Task",
        steps: task.steps.map((s: any, i: number) => ({
          id: s.id || `step-${i}`,
          action: s.action,
          params: s.params || {},
          selector: s.selector,
          description: s.description || `Step ${i + 1}`,
          expectedResult: s.expectedResult,
          continueOnError: s.continueOnError,
          retries: s.retries,
        })),
        retryPolicy: task.retryPolicy || { maxRetries: 2, backoffMs: 1000 },
        timeout: task.timeout || 120000,
        variables: task.variables || {},
        onError: task.onError || "abort",
      };

      const result = await browserController.executeAgenticTask(
        req.params.sessionId,
        agenticTask
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /** Autonomous LLM-powered navigation toward a goal */
  router.post("/sessions/:sessionId/auto-navigate", async (req: Request, res: Response) => {
    try {
      const { goal, maxSteps } = req.body;
      if (!goal) {
        return res.status(400).json({ error: "goal is required" });
      }
      const result = await browserController.agenticNavigate(
        req.params.sessionId,
        goal,
        maxSteps || 20
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export { browserController };

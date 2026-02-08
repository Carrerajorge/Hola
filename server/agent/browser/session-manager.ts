import { chromium, Browser, Page, BrowserContext, Request, Response } from "playwright";
import crypto from "crypto";
import {
  SessionConfig,
  DEFAULT_SESSION_CONFIG,
  BrowserAction,
  ActionResult,
  Observation,
  NetworkRequest,
  PageState,
  SessionEvent,
  SessionEventCallback,
  ComputerSession
} from "./types";
import { urlSecurity } from "./security/url-security";
import { BrowserContextHardener, contextHardener } from "./security/context-hardening";
import { sessionSecurity } from "./security/session-security";
import { jsSandbox } from "./security/js-sandbox";
import { selectorSanitizer } from "./security/selector-sanitizer";
import { requestInterceptor } from "./security/request-interceptor";
import { browserAuditLogger } from "./security/audit-logger";
import { fingerprintManager } from "./security/fingerprint-manager";

interface ActiveSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  config: SessionConfig;
  objective: string;
  actions: BrowserAction[];
  observations: Observation[];
  networkRequests: NetworkRequest[];
  callbacks: Set<SessionEventCallback>;
  screenshotInterval?: ReturnType<typeof setInterval>;
  createdAt: Date;
  status: "active" | "paused" | "completed" | "error" | "cancelled";
}

// Maximum stored items per session to prevent memory leaks
const MAX_NETWORK_REQUESTS_STORED = 500;
const MAX_OBSERVATIONS_STORED = 100;
const MAX_ACTIONS_STORED = 200;

class BrowserSessionManager {
  private sessions: Map<string, ActiveSession> = new Map();
  private globalCallbacks: Set<SessionEventCallback> = new Set();
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor() {
    // Start periodic health checks
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30_000);
  }

  async createSession(
    objective: string,
    config: Partial<SessionConfig> = {},
    onEvent?: SessionEventCallback
  ): Promise<string> {
    // Check if session creation is allowed
    const canCreate = sessionSecurity.canCreateSession();
    if (!canCreate.allowed) {
      browserAuditLogger.logSessionViolation("system", "session_creation_denied", {
        reason: canCreate.reason,
      });
      throw new Error(canCreate.reason || "Cannot create session");
    }

    const sessionConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
    const sessionId = crypto.randomUUID();

    // Get fingerprint for anti-detection
    const fingerprint = fingerprintManager.getFingerprintForSession(sessionId);

    // Get secure Chromium launch args
    const secureArgs = BrowserContextHardener.getSecureChromiumArgs();
    secureArgs.push(
      `--window-size=${sessionConfig.viewport!.width},${sessionConfig.viewport!.height}`
    );

    const browser = await chromium.launch({
      headless: true,
      args: secureArgs,
    });

    // Get hardened context options
    const hardenedOptions = contextHardener.getHardenedContextOptions();

    const context = await browser.newContext({
      ...hardenedOptions,
      viewport: sessionConfig.viewport,
      userAgent: sessionConfig.userAgent || fingerprint.userAgent,
      // Override: allow downloads only for sessions that need them
      acceptDownloads: false,
      timezoneId: fingerprint.timezone,
      locale: fingerprint.language,
    });

    // Apply runtime context hardening (init scripts, permission blocks, etc.)
    const hardenResult = await contextHardener.hardenContext(context);
    if (hardenResult.errors.length > 0) {
      console.warn(
        `[SessionManager] Context hardening warnings for ${sessionId}:`,
        hardenResult.errors
      );
    }

    // Apply fingerprint init script
    await context.addInitScript(fingerprintManager.getInitScript(fingerprint));

    const page = await context.newPage();

    // Install request interception
    await requestInterceptor.install(page, sessionId);

    const session: ActiveSession = {
      id: sessionId,
      browser,
      context,
      page,
      config: sessionConfig,
      objective,
      actions: [],
      observations: [],
      networkRequests: [],
      callbacks: new Set(),
      createdAt: new Date(),
      status: "active"
    };

    if (onEvent) {
      session.callbacks.add(onEvent);
    }

    if (sessionConfig.enableNetworkCapture) {
      this.setupNetworkCapture(session);
    }

    this.sessions.set(sessionId, session);

    // Register with session security manager
    sessionSecurity.registerSession(sessionId);

    browserAuditLogger.logSessionEvent(sessionId, "session_created", {
      objective: objective.slice(0, 200),
      viewport: sessionConfig.viewport,
      hardenedPolicies: hardenResult.appliedPolicies,
    });

    this.emitEvent(session, {
      type: "started",
      sessionId,
      timestamp: new Date(),
      data: { objective, config: sessionConfig }
    });

    return sessionId;
  }

  private setupNetworkCapture(session: ActiveSession): void {
    session.page.on("request", (request: Request) => {
      // Enforce network request limit per session
      if (session.networkRequests.length >= MAX_NETWORK_REQUESTS_STORED) {
        // Remove oldest entries
        session.networkRequests.splice(0, 50);
      }

      if (!sessionSecurity.recordNetworkRequest(session.id)) {
        return; // Exceeded network request limit
      }

      const req: NetworkRequest = {
        url: request.url(),
        method: request.method()
      };
      session.networkRequests.push(req);
    });

    session.page.on("response", (response: Response) => {
      const url = response.url();
      const existing = session.networkRequests.find(r => r.url === url && !r.status);
      if (existing) {
        existing.status = response.status();
        existing.mimeType = response.headers()["content-type"];
      }
    });
  }

  private emitEvent(session: ActiveSession, event: SessionEvent): void {
    session.callbacks.forEach(cb => {
      try { cb(event); } catch (e) { console.error("Event callback error:", e); }
    });
    this.globalCallbacks.forEach(cb => {
      try { cb(event); } catch (e) { console.error("Global callback error:", e); }
    });
  }

  async navigate(sessionId: string, url: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "navigate",
      params: { url },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    try {
      // URL security validation (SSRF protection)
      const urlCheck = await urlSecurity.validateUrl(url);
      if (!urlCheck.allowed) {
        browserAuditLogger.logNavigation(sessionId, url, false, urlCheck.reason);
        if (urlCheck.riskLevel === "critical") {
          browserAuditLogger.logSSRFAttempt(sessionId, url, urlCheck.reason || "");
        }
        return {
          success: false,
          action,
          error: `Navigation blocked: ${urlCheck.reason}`,
          duration: Date.now() - startTime
        };
      }

      // Use normalized URL
      const safeUrl = urlCheck.normalizedUrl || url;

      // Allowed domains check (session-level restriction)
      if (session.config.allowedDomains && session.config.allowedDomains.length > 0) {
        const domain = new URL(safeUrl).hostname;
        const allowed = session.config.allowedDomains.some(d =>
          domain === d || domain.endsWith(`.${d}`)
        );
        if (!allowed) {
          browserAuditLogger.logNavigation(sessionId, url, false, "Domain not in allowed list");
          return {
            success: false,
            action,
            error: `Domain ${domain} not in allowed list`,
            duration: Date.now() - startTime
          };
        }
      }

      await session.page.goto(safeUrl, {
        waitUntil: "networkidle",
        timeout: session.config.timeout
      });

      browserAuditLogger.logNavigation(sessionId, safeUrl, true);

      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "navigate", url: safeUrl, screenshot }
      });

      return {
        success: true,
        action,
        data: {
          url: session.page.url(),
          title: await session.page.title()
        },
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      this.emitEvent(session, {
        type: "error",
        sessionId,
        timestamp: new Date(),
        data: { action: "navigate", error: error.message }
      });

      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async click(sessionId: string, selector: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Validate selector
    const selectorCheck = selectorSanitizer.validate(selector);
    if (!selectorCheck.valid) {
      browserAuditLogger.logSelectorBlocked(sessionId, selector, selectorCheck.reason || "");
      return {
        success: false,
        action: { type: "click", params: { selector }, timestamp: new Date() },
        error: `Selector blocked: ${selectorCheck.reason}`,
        duration: 0,
      };
    }
    const safeSelector = selectorCheck.sanitizedSelector || selector;

    const action: BrowserAction = {
      type: "click",
      params: { selector: safeSelector },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    try {
      await session.page.click(safeSelector, { timeout: 10000 });
      await session.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "click", selector: safeSelector, screenshot }
      });

      return {
        success: true,
        action,
        data: { newUrl: session.page.url() },
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async type(sessionId: string, selector: string, text: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Validate selector
    const selectorCheck = selectorSanitizer.validate(selector);
    if (!selectorCheck.valid) {
      browserAuditLogger.logSelectorBlocked(sessionId, selector, selectorCheck.reason || "");
      return {
        success: false,
        action: { type: "type", params: { selector, text: "[redacted]" }, timestamp: new Date() },
        error: `Selector blocked: ${selectorCheck.reason}`,
        duration: 0,
      };
    }
    const safeSelector = selectorCheck.sanitizedSelector || selector;

    // Limit text length
    const safeText = text.slice(0, 50000);

    const action: BrowserAction = {
      type: "type",
      params: { selector: safeSelector, textLength: safeText.length },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    try {
      await session.page.fill(safeSelector, safeText, { timeout: 10000 });

      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "type", selector: safeSelector, textLength: safeText.length, screenshot }
      });

      return {
        success: true,
        action,
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async scroll(sessionId: string, direction: "up" | "down", amount: number = 300): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Sanitize direction and amount
    const safeDirection = direction === "up" ? "up" : "down";
    const safeAmount = Math.min(Math.max(0, Math.floor(amount)), 10000);

    const action: BrowserAction = {
      type: "scroll",
      params: { direction: safeDirection, amount: safeAmount },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    try {
      const scrollAmount = safeDirection === "down" ? safeAmount : -safeAmount;
      await session.page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
      await session.page.waitForTimeout(300);

      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "scroll", direction: safeDirection, amount: safeAmount, screenshot }
      });

      return {
        success: true,
        action,
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async wait(sessionId: string, ms: number): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Cap wait time to prevent resource exhaustion
    const safeMs = Math.min(Math.max(0, Math.floor(ms)), 30000);

    const action: BrowserAction = {
      type: "wait",
      params: { ms: safeMs },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    await session.page.waitForTimeout(safeMs);
    const screenshot = await this.captureScreenshot(session);

    return {
      success: true,
      action,
      screenshot,
      duration: Date.now() - startTime
    };
  }

  async evaluate(sessionId: string, script: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Validate script through JS sandbox
    const validation = jsSandbox.validateScript(script);
    if (!validation.allowed) {
      browserAuditLogger.logJsExecution(sessionId, script, false, validation.reason);
      return {
        success: false,
        action: { type: "evaluate", params: { scriptLength: script.length }, timestamp: new Date() },
        error: `Script blocked: ${validation.reason}`,
        duration: 0,
      };
    }

    browserAuditLogger.logJsExecution(sessionId, script, true);

    const action: BrowserAction = {
      type: "evaluate",
      params: { scriptLength: script.length },
      timestamp: new Date()
    };
    this.recordAction(session, action);

    const startTime = Date.now();

    try {
      // Wrap script with safe execution context
      const safeScript = jsSandbox.wrapScript(script);
      const result = await session.page.evaluate(safeScript);

      // Check for truncated/error results from wrapper
      if (result && typeof result === "object") {
        if ((result as any).__error) {
          return {
            success: false,
            action,
            error: (result as any).message || "Script execution error",
            duration: Date.now() - startTime,
          };
        }
        if ((result as any).__truncated) {
          return {
            success: true,
            action,
            data: { message: "Result truncated: exceeds size limit" },
            duration: Date.now() - startTime,
          };
        }
      }

      return {
        success: true,
        action,
        data: result,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  private async captureScreenshot(session: ActiveSession): Promise<string> {
    try {
      const buffer = await session.page.screenshot({
        type: "png",
        fullPage: false
      });

      // Track screenshot in session security
      sessionSecurity.recordScreenshot(session.id, buffer.length);

      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      return "";
    }
  }

  async getPageState(sessionId: string): Promise<PageState | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      // This script is internal and trusted - uses wrapScript for size limits
      const state = await session.page.evaluate(`
        (function() {
          var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
          );
          var visibleText = "";
          var node;
          while (node = walker.nextNode()) {
            var parent = node.parentElement;
            if (parent && getComputedStyle(parent).display !== "none") {
              var txt = node.textContent;
              if (txt) visibleText += txt.trim() + " ";
            }
          }
          visibleText = visibleText.slice(0, 10000);

          var links = Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map(function(a) {
            return {
              text: (a.textContent || "").trim().slice(0, 200),
              href: a.href.slice(0, 2000)
            };
          });

          var forms = Array.from(document.querySelectorAll("form")).slice(0, 10).map(function(f) {
            return {
              action: (f.action || "").slice(0, 2000),
              inputs: Array.from(f.querySelectorAll("input, textarea, select")).map(function(i) {
                return i.name || i.id || "";
              }).filter(Boolean).slice(0, 20)
            };
          });

          var images = Array.from(document.querySelectorAll("img[src]")).slice(0, 20).map(function(i) {
            return {
              src: i.src.slice(0, 2000),
              alt: (i.alt || "").slice(0, 200)
            };
          });

          var metaTags = {};
          var metaCount = 0;
          document.querySelectorAll("meta[name], meta[property]").forEach(function(m) {
            if (metaCount >= 30) return;
            var name = m.getAttribute("name") || m.getAttribute("property") || "";
            var content = m.getAttribute("content") || "";
            if (name && content) {
              metaTags[name.slice(0, 100)] = content.slice(0, 500);
              metaCount++;
            }
          });

          var jsonLd = [];
          document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s) {
            if (jsonLd.length >= 3) return;
            try {
              var parsed = JSON.parse(s.textContent || "");
              var str = JSON.stringify(parsed);
              if (str.length <= 5000) jsonLd.push(parsed);
            } catch(e) {}
          });

          return {
            url: window.location.href,
            title: document.title.slice(0, 500),
            visibleText: visibleText,
            links: links,
            forms: forms,
            images: images,
            metaTags: metaTags,
            jsonLd: jsonLd
          };
        })()
      `);

      // Record observation with size tracking
      const observationSize = JSON.stringify(state).length;
      sessionSecurity.recordObservation(sessionId, observationSize);

      if (session.observations.length >= MAX_OBSERVATIONS_STORED) {
        session.observations.splice(0, 20);
      }

      const observation: Observation = {
        sessionId,
        timestamp: new Date(),
        type: "state",
        data: state
      };
      session.observations.push(observation);

      this.emitEvent(session, {
        type: "observation",
        sessionId,
        timestamp: new Date(),
        data: { type: "state", state }
      });

      return state as PageState;
    } catch (error) {
      console.error("Failed to get page state:", error);
      return null;
    }
  }

  async getScreenshot(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const screenshot = await this.captureScreenshot(session);

    if (session.observations.length >= MAX_OBSERVATIONS_STORED) {
      session.observations.splice(0, 20);
    }

    const observation: Observation = {
      sessionId,
      timestamp: new Date(),
      type: "screenshot",
      data: { screenshot }
    };
    session.observations.push(observation);

    this.emitEvent(session, {
      type: "observation",
      sessionId,
      timestamp: new Date(),
      data: { type: "screenshot", screenshot }
    });

    return screenshot;
  }

  startScreenshotStreaming(sessionId: string, intervalMs: number = 2000): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Enforce minimum interval to prevent resource exhaustion
    const safeInterval = Math.max(intervalMs, 500);

    if (session.screenshotInterval) {
      clearInterval(session.screenshotInterval);
    }

    session.screenshotInterval = setInterval(async () => {
      if (session.status !== "active") {
        this.stopScreenshotStreaming(sessionId);
        return;
      }
      await this.getScreenshot(sessionId);
    }, safeInterval);
  }

  stopScreenshotStreaming(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.screenshotInterval) {
      clearInterval(session.screenshotInterval);
      session.screenshotInterval = undefined;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.stopScreenshotStreaming(sessionId);

    session.status = "completed";

    browserAuditLogger.logSessionEvent(sessionId, "session_closed", {
      actions: session.actions.length,
      observations: session.observations.length,
      duration: Date.now() - session.createdAt.getTime(),
      interceptorStats: requestInterceptor.getStats(sessionId),
    });

    this.emitEvent(session, {
      type: "completed",
      sessionId,
      timestamp: new Date(),
      data: {
        actions: session.actions.length,
        observations: session.observations.length,
        duration: Date.now() - session.createdAt.getTime()
      }
    });

    try {
      // Clean up cookie monitor
      BrowserContextHardener.cleanupContext(session.context);

      // Clear cookies and storage before closing
      await session.context.clearCookies();
      await session.context.clearPermissions();
      await session.context.close();
      await session.browser.close();
    } catch (e) {
      console.error("Error closing session:", e);
    }

    // Clean up security tracking
    sessionSecurity.unregisterSession(sessionId);
    requestInterceptor.clearStats(sessionId);
    fingerprintManager.clearSession(sessionId);
    browserAuditLogger.clearSessionEvents(sessionId);

    this.sessions.delete(sessionId);
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "cancelled";

    browserAuditLogger.logSessionEvent(sessionId, "session_cancelled");

    this.emitEvent(session, {
      type: "cancelled",
      sessionId,
      timestamp: new Date(),
      data: { reason: "User cancelled" }
    });

    this.closeSession(sessionId).catch(() => {});
  }

  getSession(sessionId: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      status: session.status,
      startedAt: session.createdAt,
      objective: session.objective,
      actions: session.actions,
      observations: session.observations,
      currentUrl: session.page.url(),
      currentTitle: undefined
    };
  }

  addGlobalEventListener(callback: SessionEventCallback): void {
    this.globalCallbacks.add(callback);
  }

  removeGlobalEventListener(callback: SessionEventCallback): void {
    this.globalCallbacks.delete(callback);
  }

  addSessionEventListener(sessionId: string, callback: SessionEventCallback): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.callbacks.add(callback);
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Periodic health check for all active sessions
   */
  private performHealthChecks(): void {
    for (const [sessionId, session] of this.sessions) {
      const health = sessionSecurity.checkSessionHealth(sessionId);
      if (health.shouldTerminate) {
        console.warn(
          `[SessionManager] Terminating unhealthy session ${sessionId}: ${health.reason}`
        );
        browserAuditLogger.logSessionViolation(sessionId, "session_health_terminated", {
          reason: health.reason,
        });
        this.closeSession(sessionId).catch(() => {});
      }
    }
  }

  /**
   * Record an action with bounds checking
   */
  private recordAction(session: ActiveSession, action: BrowserAction): void {
    if (session.actions.length >= MAX_ACTIONS_STORED) {
      session.actions.splice(0, 50);
    }
    session.actions.push(action);
  }

  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.closeSession(id);
    }
  }
}

export const browserSessionManager = new BrowserSessionManager();

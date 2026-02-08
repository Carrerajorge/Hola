import { chromium, Browser, Page, BrowserContext } from "playwright";
import crypto from "crypto";
import { BrowserContextHardener } from "./browser/security/context-hardening";
import { urlSecurity } from "./browser/security/url-security";
import { sessionSecurity } from "./browser/security/session-security";
import { requestInterceptor } from "./browser/security/request-interceptor";
import { fingerprintManager } from "./browser/security/fingerprint-manager";
import { browserAuditLogger } from "./browser/security/audit-logger";

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
}

export interface NavigationResult {
  success: boolean;
  url: string;
  title: string;
  html?: string;
  screenshot?: Buffer;
  error?: string;
  timing: {
    navigationMs: number;
    renderMs: number;
  };
}

export interface ClickResult {
  success: boolean;
  selector: string;
  newUrl?: string;
  error?: string;
}

export interface InputResult {
  success: boolean;
  selector: string;
  error?: string;
}

// Maximum HTML content size to prevent memory exhaustion
const MAX_HTML_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
// Maximum concurrent sessions for the shared browser instance
const MAX_WORKER_SESSIONS = 10;
// Session TTL - auto-cleanup after this time
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

class BrowserWorker {
  private sessions: Map<string, BrowserSession> = new Map();
  private browser: Browser | null = null;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor() {
    // Start periodic stale session cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions();
    }, 60_000);
  }

  async initialize(): Promise<void> {
    if (this.browser) return;

    try {
      const secureArgs = BrowserContextHardener.getSecureChromiumArgs();
      secureArgs.push("--window-size=1920,1080");

      this.browser = await chromium.launch({
        headless: true,
        args: secureArgs,
      });
      console.log("Browser worker initialized with hardened security");
    } catch (error) {
      console.error("Failed to initialize browser:", error);
      throw error;
    }
  }

  async createSession(): Promise<string> {
    await this.initialize();

    // Enforce concurrent session limit
    if (this.sessions.size >= MAX_WORKER_SESSIONS) {
      // Try to clean up stale sessions first
      this.cleanupStaleSessions();
      if (this.sessions.size >= MAX_WORKER_SESSIONS) {
        throw new Error(
          `Maximum concurrent sessions (${MAX_WORKER_SESSIONS}) reached for browser worker`
        );
      }
    }

    const sessionId = crypto.randomUUID();

    // Get fingerprint for this session
    const fingerprint = fingerprintManager.getFingerprintForSession(sessionId);

    // Create hardened context
    const hardenedOptions = new BrowserContextHardener().getHardenedContextOptions();
    const context = await this.browser!.newContext({
      ...hardenedOptions,
      viewport: { width: 1920, height: 1080 },
      userAgent: fingerprint.userAgent,
      timezoneId: fingerprint.timezone,
      locale: fingerprint.language,
      acceptDownloads: false,
    });

    // Apply context hardening
    const hardener = new BrowserContextHardener();
    await hardener.hardenContext(context);

    // Apply fingerprint init script
    await context.addInitScript(fingerprintManager.getInitScript(fingerprint));

    const page = await context.newPage();

    // Install request interception
    await requestInterceptor.install(page, sessionId);

    this.sessions.set(sessionId, {
      id: sessionId,
      browser: this.browser!,
      context,
      page,
      createdAt: new Date()
    });

    // Register with session security manager
    sessionSecurity.registerSession(sessionId);

    browserAuditLogger.logSessionEvent(sessionId, "worker_session_created", {
      totalSessions: this.sessions.size,
    });

    return sessionId;
  }

  async navigate(sessionId: string, url: string, takeScreenshot: boolean = true): Promise<NavigationResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();

    // URL security validation
    const urlCheck = await urlSecurity.validateUrl(url);
    if (!urlCheck.allowed) {
      browserAuditLogger.logNavigation(sessionId, url, false, urlCheck.reason);
      if (urlCheck.riskLevel === "critical") {
        browserAuditLogger.logSSRFAttempt(sessionId, url, urlCheck.reason || "");
      }
      return {
        success: false,
        url,
        title: "",
        error: `Navigation blocked: ${urlCheck.reason}`,
        timing: {
          navigationMs: Date.now() - startTime,
          renderMs: 0
        }
      };
    }

    const safeUrl = urlCheck.normalizedUrl || url;

    try {
      await session.page.goto(safeUrl, {
        waitUntil: "networkidle",
        timeout: 30000
      });

      const navigationTime = Date.now() - startTime;

      await session.page.waitForLoadState("domcontentloaded");
      const renderTime = Date.now() - startTime - navigationTime;

      const title = await session.page.title();

      // Get HTML with size limit
      let html: string | undefined;
      try {
        const rawHtml = await session.page.content();
        html = rawHtml.length > MAX_HTML_CONTENT_SIZE
          ? rawHtml.slice(0, MAX_HTML_CONTENT_SIZE)
          : rawHtml;
      } catch {
        html = undefined;
      }

      let screenshot: Buffer | undefined;
      if (takeScreenshot) {
        screenshot = await session.page.screenshot({
          type: "png",
          fullPage: false
        });
        // Track screenshot
        if (screenshot) {
          sessionSecurity.recordScreenshot(sessionId, screenshot.length);
        }
      }

      browserAuditLogger.logNavigation(sessionId, safeUrl, true);

      return {
        success: true,
        url: session.page.url(),
        title,
        html,
        screenshot,
        timing: {
          navigationMs: navigationTime,
          renderMs: renderTime
        }
      };
    } catch (error: any) {
      return {
        success: false,
        url,
        title: "",
        error: error.message,
        timing: {
          navigationMs: Date.now() - startTime,
          renderMs: 0
        }
      };
    }
  }

  async click(sessionId: string, selector: string): Promise<ClickResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Validate selector
    if (!selector || typeof selector !== "string" || selector.length > 1000) {
      return {
        success: false,
        selector,
        error: "Invalid selector"
      };
    }

    try {
      await session.page.click(selector, { timeout: 10000 });
      await session.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

      return {
        success: true,
        selector,
        newUrl: session.page.url()
      };
    } catch (error: any) {
      return {
        success: false,
        selector,
        error: error.message
      };
    }
  }

  async type(sessionId: string, selector: string, text: string): Promise<InputResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Validate inputs
    if (!selector || typeof selector !== "string" || selector.length > 1000) {
      return { success: false, selector, error: "Invalid selector" };
    }

    // Limit text length
    const safeText = text.slice(0, 50000);

    try {
      await session.page.fill(selector, safeText, { timeout: 10000 });
      return { success: true, selector };
    } catch (error: any) {
      return { success: false, selector, error: error.message };
    }
  }

  async pressKey(sessionId: string, key: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Validate key
    if (!key || typeof key !== "string" || key.length > 50) {
      return false;
    }

    try {
      await session.page.keyboard.press(key);
      return true;
    } catch {
      return false;
    }
  }

  async screenshot(sessionId: string, fullPage: boolean = false): Promise<Buffer | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      const buffer = await session.page.screenshot({
        type: "png",
        fullPage
      });
      sessionSecurity.recordScreenshot(sessionId, buffer.length);
      return buffer;
    } catch {
      return null;
    }
  }

  async getHtml(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      const html = await session.page.content();
      // Enforce size limit
      return html.length > MAX_HTML_CONTENT_SIZE
        ? html.slice(0, MAX_HTML_CONTENT_SIZE)
        : html;
    } catch {
      return null;
    }
  }

  async getUrl(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return session.page.url();
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Clean up context hardening (cookie monitors, etc.)
      BrowserContextHardener.cleanupContext(session.context);
      await session.context.close();
    } catch (e) {
      console.error("Error closing session:", e);
    }

    // Clean up security tracking
    sessionSecurity.unregisterSession(sessionId);
    requestInterceptor.clearStats(sessionId);
    fingerprintManager.clearSession(sessionId);

    this.sessions.delete(sessionId);

    browserAuditLogger.logSessionEvent(sessionId, "worker_session_destroyed", {
      remainingSessions: this.sessions.size,
    });
  }

  /**
   * Clean up sessions that have exceeded their TTL
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.createdAt.getTime() > SESSION_TTL_MS) {
        console.warn(`[BrowserWorker] Cleaning up stale session ${sessionId}`);
        browserAuditLogger.logSessionViolation(sessionId, "stale_session_cleanup", {
          ageMs: now - session.createdAt.getTime(),
          ttlMs: SESSION_TTL_MS,
        });
        this.destroySession(sessionId).catch(() => {});
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.destroySession(id);
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}

export const browserWorker = new BrowserWorker();

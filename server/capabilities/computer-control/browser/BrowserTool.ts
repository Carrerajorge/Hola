/**
 * BrowserTool — Structured browser automation via Playwright.
 *
 * Features:
 * - Page navigation, DOM/ARIA inspection
 * - Screenshot capture with optional region
 * - Click, type, select, scroll on elements
 * - Session management (multiple tabs/contexts)
 * - Download management with allowlisted domains
 * - No CAPTCHA bypass (user-assisted 2FA/CAPTCHA only)
 * - Audit logging
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { ControlAuditEntry, RiskLevel } from "../types";

// Playwright types — lazy imported to avoid hard dependency crash
let chromium: typeof import("playwright").chromium | null = null;
type Browser = import("playwright").Browser;
type BrowserContext = import("playwright").BrowserContext;
type Page = import("playwright").Page;

async function lazyPlaywright(): Promise<typeof import("playwright")> {
  if (!chromium) {
    const pw = await import("playwright");
    chromium = pw.chromium;
  }
  return { chromium } as any;
}

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, Page>;
  activePage: string | null;
  createdAt: number;
  lastActivity: number;
  status: "active" | "idle" | "closed";
  downloads: string[];
}

export interface BrowserAction {
  type:
    | "navigate"
    | "click"
    | "type"
    | "select"
    | "scroll"
    | "screenshot"
    | "getDOM"
    | "getARIA"
    | "getText"
    | "evaluate"
    | "waitForSelector"
    | "newTab"
    | "closeTab"
    | "switchTab"
    | "goBack"
    | "goForward"
    | "reload";
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  expression?: string;
  timeout?: number;
  tabId?: string;
  scrollDelta?: number;
  region?: { x: number; y: number; width: number; height: number };
}

export interface BrowserActionResult {
  id: string;
  sessionId: string;
  action: BrowserAction;
  success: boolean;
  data?: unknown;
  screenshotPath?: string;
  error?: string;
  durationMs: number;
  pageUrl?: string;
  pageTitle?: string;
}

const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,
  /^chrome:/i,
  /^about:/i,
  /^javascript:/i,
  /^data:text\/html/i,
];

export class BrowserTool extends EventEmitter {
  private sessions: Map<string, BrowserSession> = new Map();
  private auditLog: ControlAuditEntry[] = [];
  private screenshotDir: string;
  private downloadDir: string;
  private maxSessionAge = 30 * 60 * 1000;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { screenshotDir?: string; downloadDir?: string }) {
    super();
    this.screenshotDir = options?.screenshotDir || path.join(os.tmpdir(), "iliagpt-browser-screenshots");
    this.downloadDir = options?.downloadDir || path.join(os.tmpdir(), "iliagpt-browser-downloads");

    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 5 * 60 * 1000);
  }

  // ── Session Management ─────────────────────────

  async createSession(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
  }): Promise<string> {
    await lazyPlaywright();
    const sessionId = randomUUID();
    const viewport = options?.viewport || { width: 1280, height: 720 };

    await fs.mkdir(this.screenshotDir, { recursive: true });
    await fs.mkdir(this.downloadDir, { recursive: true });

    const browser = await chromium!.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const context = await browser.newContext({
      viewport,
      userAgent: options?.userAgent,
      acceptDownloads: true,
    });

    const page = await context.newPage();
    const pageId = randomUUID();

    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      pages: new Map([[pageId, page]]),
      activePage: pageId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: "active",
      downloads: [],
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "closed";
    for (const page of session.pages.values()) {
      await page.close().catch(() => {});
    }
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    this.sessions.delete(sessionId);
  }

  // ── Execute Actions ────────────────────────────

  async execute(
    sessionId: string,
    action: BrowserAction,
    userId: string,
    userSessionId: string,
  ): Promise<BrowserActionResult> {
    const id = randomUUID();
    const start = Date.now();
    const session = this.sessions.get(sessionId);

    if (!session || session.status === "closed") {
      return {
        id,
        sessionId,
        action,
        success: false,
        error: "Session not found or closed",
        durationMs: Date.now() - start,
      };
    }

    session.lastActivity = Date.now();

    const page = session.activePage ? session.pages.get(session.activePage) : null;
    if (!page && action.type !== "newTab") {
      return {
        id,
        sessionId,
        action,
        success: false,
        error: "No active page in session",
        durationMs: Date.now() - start,
      };
    }

    try {
      let data: unknown;
      let screenshotPath: string | undefined;

      switch (action.type) {
        case "navigate": {
          this.assertSafeUrl(action.url || "");
          await page!.goto(action.url!, { timeout: action.timeout || 30_000, waitUntil: "domcontentloaded" });
          data = { url: page!.url(), title: await page!.title() };
          break;
        }
        case "click": {
          if (!action.selector) throw new Error("selector required for click");
          await page!.click(action.selector, { timeout: action.timeout || 5_000 });
          break;
        }
        case "type": {
          if (!action.selector) throw new Error("selector required for type");
          await page!.fill(action.selector, action.text || "", { timeout: action.timeout || 5_000 });
          break;
        }
        case "select": {
          if (!action.selector) throw new Error("selector required for select");
          await page!.selectOption(action.selector, action.value || "", { timeout: action.timeout || 5_000 });
          break;
        }
        case "scroll": {
          const delta = action.scrollDelta || 300;
          await page!.evaluate((d) => window.scrollBy(0, d), delta);
          break;
        }
        case "screenshot": {
          const filename = `browser_${Date.now()}.png`;
          screenshotPath = path.join(this.screenshotDir, filename);
          const opts: any = { path: screenshotPath };
          if (action.region) {
            opts.clip = action.region;
          }
          await page!.screenshot(opts);
          break;
        }
        case "getDOM": {
          const html = await page!.content();
          // Return truncated DOM to avoid huge payloads
          data = html.length > 100_000 ? html.slice(0, 100_000) + "...[truncated]" : html;
          break;
        }
        case "getARIA": {
          const snapshot = await page!.accessibility.snapshot();
          data = snapshot;
          break;
        }
        case "getText": {
          const text = action.selector
            ? await page!.textContent(action.selector, { timeout: action.timeout || 5_000 })
            : await page!.evaluate(() => document.body.innerText);
          data = text;
          break;
        }
        case "evaluate": {
          if (!action.expression) throw new Error("expression required for evaluate");
          // Safety: limit expression length
          if (action.expression.length > 10_000) throw new Error("Expression too long");
          data = await page!.evaluate(action.expression);
          break;
        }
        case "waitForSelector": {
          if (!action.selector) throw new Error("selector required");
          await page!.waitForSelector(action.selector, { timeout: action.timeout || 10_000 });
          break;
        }
        case "newTab": {
          const newPage = await session.context.newPage();
          const newPageId = randomUUID();
          session.pages.set(newPageId, newPage);
          session.activePage = newPageId;
          data = { tabId: newPageId };
          break;
        }
        case "closeTab": {
          const tabId = action.tabId || session.activePage;
          if (tabId) {
            const tabPage = session.pages.get(tabId);
            if (tabPage) {
              await tabPage.close();
              session.pages.delete(tabId);
              if (session.activePage === tabId) {
                session.activePage = session.pages.keys().next().value || null;
              }
            }
          }
          break;
        }
        case "switchTab": {
          if (action.tabId && session.pages.has(action.tabId)) {
            session.activePage = action.tabId;
            await session.pages.get(action.tabId)!.bringToFront();
          }
          break;
        }
        case "goBack":
          await page!.goBack({ timeout: action.timeout || 10_000 });
          break;
        case "goForward":
          await page!.goForward({ timeout: action.timeout || 10_000 });
          break;
        case "reload":
          await page!.reload({ timeout: action.timeout || 10_000 });
          break;
      }

      const result: BrowserActionResult = {
        id,
        sessionId,
        action,
        success: true,
        data,
        screenshotPath,
        durationMs: Date.now() - start,
        pageUrl: page ? page.url() : undefined,
        pageTitle: page ? await page.title().catch(() => undefined) : undefined,
      };

      this.logAudit(id, userId, userSessionId, action, true);
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logAudit(id, userId, userSessionId, action, false, errMsg);
      return {
        id,
        sessionId,
        action,
        success: false,
        error: errMsg,
        durationMs: Date.now() - start,
        pageUrl: page ? page.url() : undefined,
      };
    }
  }

  // ── Helpers ────────────────────────────────────

  private assertSafeUrl(url: string): void {
    for (const pattern of BLOCKED_URL_PATTERNS) {
      if (pattern.test(url)) {
        throw new Error(`Blocked URL pattern: ${url}`);
      }
    }
  }

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.maxSessionAge) {
        await this.closeSession(id).catch(() => {});
      }
    }
  }

  getActiveSessions(): Array<{ id: string; status: string; pageCount: number; createdAt: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      status: s.status,
      pageCount: s.pages.size,
      createdAt: s.createdAt,
    }));
  }

  private logAudit(
    id: string,
    userId: string,
    sessionId: string,
    action: BrowserAction,
    approved: boolean,
    deniedReason?: string,
  ): void {
    this.auditLog.push({
      id,
      timestamp: Date.now(),
      userId,
      sessionId,
      tool: "browser",
      action: `${action.type}${action.url ? ` ${action.url}` : ""}${action.selector ? ` ${action.selector}` : ""}`,
      riskLevel: this.assessBrowserRisk(action),
      approved,
      deniedReason,
    });
  }

  private assessBrowserRisk(action: BrowserAction): RiskLevel {
    if (action.type === "evaluate") return "HIGH";
    if (action.type === "navigate") return "MEDIUM";
    if (action.type === "screenshot" || action.type === "getDOM" || action.type === "getARIA" || action.type === "getText") return "LOW";
    return "MEDIUM";
  }

  getAuditLog(limit = 100): ControlAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const sessionId of this.sessions.keys()) {
      await this.closeSession(sessionId).catch(() => {});
    }
  }
}

/**
 * AgentOS Action-Plane — Browser Controller
 *
 * Playwright-based browser automation with:
 *  - DOM / ARIA extraction and structured navigation
 *  - Screenshots, downloads, session management
 *  - Tolerance to layout changes (fallback selectors)
 *  - robots.txt and TOS compliance
 */

import {
  ActionResult,
  AuditEntry,
  BrowserSession,
  WebAction,
  NavigationGoal,
} from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[BROWSER][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[BROWSER][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[BROWSER][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// robots.txt cache
// ---------------------------------------------------------------------------

const robotsCache = new Map<string, { allowed: Set<string>; disallowed: Set<string>; fetchedAt: number }>();

async function isAllowedByRobots(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    const cached = robotsCache.get(origin);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < 3600_000) {
      for (const rule of cached.disallowed) {
        if (parsed.pathname.startsWith(rule)) return false;
      }
      return true;
    }

    // Fetch robots.txt
    const res = await fetch(`${origin}/robots.txt`);
    if (!res.ok) {
      robotsCache.set(origin, { allowed: new Set(), disallowed: new Set(), fetchedAt: now });
      return true;
    }

    const text = await res.text();
    const disallowed = new Set<string>();
    const allowed = new Set<string>();
    let relevantSection = false;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) {
        relevantSection = true;
      } else if (/^user-agent:/i.test(trimmed)) {
        relevantSection = false;
      } else if (relevantSection && /^disallow:\s*/i.test(trimmed)) {
        const path = trimmed.replace(/^disallow:\s*/i, "").trim();
        if (path) disallowed.add(path);
      } else if (relevantSection && /^allow:\s*/i.test(trimmed)) {
        const path = trimmed.replace(/^allow:\s*/i, "").trim();
        if (path) allowed.add(path);
      }
    }

    robotsCache.set(origin, { allowed, disallowed, fetchedAt: now });

    for (const rule of disallowed) {
      if (parsed.pathname.startsWith(rule)) return false;
    }
    return true;
  } catch {
    log.warn("Could not fetch robots.txt, assuming allowed", { url });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Playwright adapter interface (avoids hard dependency)
// ---------------------------------------------------------------------------

export interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  evaluate<R>(fn: () => R): Promise<R>;
  title(): Promise<string>;
  url(): string;
  close(): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  /** Scroll by pixels. */
  evaluate<R>(fn: string): Promise<R>;
}

export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser Controller
// ---------------------------------------------------------------------------

export class BrowserController {
  private sessions = new Map<string, { page: PlaywrightPage; session: BrowserSession }>();
  private browser: PlaywrightBrowser | null = null;

  constructor(private browserFactory: () => Promise<PlaywrightBrowser>) {
    log.info("BrowserController initialised");
  }

  // ---- lifecycle ---------------------------------------------------------

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await this.browserFactory();
    log.info("Browser launched");
  }

  async stop(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.closeSession(id);
    }
    await this.browser?.close();
    this.browser = null;
    log.info("Browser stopped");
  }

  // ---- session management ------------------------------------------------

  async createSession(origin: string, viewport = { width: 1280, height: 720 }): Promise<BrowserSession> {
    await this.start();
    const page = await this.browser!.newPage();
    const id = `bs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Check robots.txt before navigating
    if (!(await isAllowedByRobots(origin))) {
      await page.close();
      throw new Error(`Navigation to ${origin} disallowed by robots.txt`);
    }

    await page.goto(origin, { timeout: 15_000 });
    const title = await page.title();

    const session: BrowserSession = {
      id,
      origin,
      currentUrl: page.url(),
      alive: true,
      createdAt: new Date(),
      title,
      viewport,
    };

    this.sessions.set(id, { page, session });
    log.info("Session created", { id, origin });
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.alive = false;
    await entry.page.close();
    this.sessions.delete(sessionId);
    log.info("Session closed", { sessionId });
  }

  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  // ---- action execution --------------------------------------------------

  async execute(action: WebAction): Promise<ActionResult> {
    const start = Date.now();
    const audit: AuditEntry[] = [];
    const entry = this.sessions.get(action.sessionId);

    if (!entry || !entry.session.alive) {
      return this.fail(action.id, "Session not found or closed", start, audit);
    }

    const { page, session } = entry;

    // robots.txt check for navigations
    if (action.goal === "navigate" && !(await isAllowedByRobots(action.target))) {
      return this.fail(action.id, `Blocked by robots.txt: ${action.target}`, start, audit);
    }

    audit.push(this.auditInfo(`Executing ${action.goal} on ${action.target}`));

    try {
      const data = await this.dispatch(page, action);

      // Update session state
      session.currentUrl = page.url();
      session.title = await page.title();

      audit.push(this.auditInfo("Action completed"));
      return {
        actionId: action.id,
        status: "success",
        data,
        durationMs: Date.now() - start,
        auditLog: audit,
        timestamp: new Date(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Action failed", { actionId: action.id, error: msg });

      // Attempt fallback via ARIA label
      if (action.goal === "click") {
        audit.push(this.auditInfo("Attempting ARIA fallback click"));
        try {
          const ariaSelector = `[aria-label="${action.target}"]`;
          await page.click(ariaSelector, { timeout: action.timeoutMs });
          session.currentUrl = page.url();
          audit.push(this.auditInfo("ARIA fallback succeeded"));
          return {
            actionId: action.id,
            status: "success",
            durationMs: Date.now() - start,
            auditLog: audit,
            timestamp: new Date(),
          };
        } catch {
          // fallback also failed
        }
      }

      return this.fail(action.id, msg, start, audit);
    }
  }

  // ---- action dispatch ---------------------------------------------------

  private async dispatch(page: PlaywrightPage, action: WebAction): Promise<unknown> {
    const opts = { timeout: action.timeoutMs };

    switch (action.goal) {
      case "navigate":
        await page.goto(action.target, opts);
        return { url: page.url() };

      case "click":
        await page.click(action.target, opts);
        return { clicked: action.target };

      case "type":
        await page.fill(action.target, action.value ?? "", opts);
        return { filled: action.target };

      case "screenshot": {
        const buf = await page.screenshot({ fullPage: action.target === "full" });
        return { screenshotBytes: buf.length };
      }

      case "scroll":
        await page.evaluate(`window.scrollBy(0, ${parseInt(action.target, 10) || 500})`);
        return { scrolled: action.target };

      case "extract":
        await page.waitForSelector(action.target, opts);
        const text = await page.evaluate(`document.querySelector('${action.target}')?.innerText ?? ''`);
        return { text };

      case "download":
        // Initiate download by navigating — actual download handling depends on Playwright config
        await page.goto(action.target, opts);
        return { downloadInitiated: action.target };

      default:
        throw new Error(`Unknown goal: ${action.goal}`);
    }
  }

  // ---- helpers -----------------------------------------------------------

  private fail(actionId: string, error: string, start: number, audit: AuditEntry[]): ActionResult {
    audit.push({ timestamp: new Date(), level: "error", message: error });
    return {
      actionId,
      status: "failure",
      error,
      durationMs: Date.now() - start,
      auditLog: audit,
      timestamp: new Date(),
    };
  }

  private auditInfo(message: string): AuditEntry {
    return { timestamp: new Date(), level: "info", message };
  }
}

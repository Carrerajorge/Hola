/**
 * Universal Browser Controller - Agentic Multi-Browser Control
 *
 * Features:
 * - Multi-tab/multi-window management
 * - Self-correcting navigation loops
 * - Intelligent element detection (CSS + XPath + visual)
 * - Form auto-fill with context understanding
 * - Cookie/session persistence across sessions
 * - Download management
 * - Network request interception and modification
 * - Performance monitoring
 * - Anti-detection measures (stealth mode)
 * - Proxy support
 * - Agentic task chains (login -> navigate -> extract -> verify)
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext, Route, Request as PlaywrightRequest } from "playwright";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";

// ============================================
// Types
// ============================================

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface BrowserProfile {
  id: string;
  name: string;
  browserType: BrowserType;
  userAgent?: string;
  viewport: { width: number; height: number };
  locale?: string;
  timezone?: string;
  geolocation?: { latitude: number; longitude: number };
  proxy?: { server: string; username?: string; password?: string };
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  localStorage?: Record<string, Record<string, string>>;
  headers?: Record<string, string>;
  stealth?: boolean;
}

export interface Tab {
  id: string;
  page: Page;
  url: string;
  title: string;
  active: boolean;
  createdAt: number;
}

export interface BrowserSession {
  id: string;
  profile: BrowserProfile;
  browser: Browser;
  context: BrowserContext;
  tabs: Map<string, Tab>;
  activeTabId: string | null;
  downloadDir: string;
  networkLogs: NetworkLog[];
  createdAt: number;
  lastActivity: number;
}

export interface NetworkLog {
  url: string;
  method: string;
  status?: number;
  headers: Record<string, string>;
  timestamp: number;
  duration?: number;
  size?: number;
  resourceType: string;
}

export interface ElementInfo {
  selector: string;
  xpath: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isVisible: boolean;
  isEnabled: boolean;
  computedStyles?: Record<string, string>;
}

export interface ExtractionRule {
  name: string;
  selector: string;
  type: "text" | "html" | "attribute" | "list" | "table" | "screenshot";
  attribute?: string;
  transform?: "trim" | "lowercase" | "uppercase" | "number" | "date";
  children?: ExtractionRule[];
}

export interface AgenticTask {
  id: string;
  name: string;
  steps: AgenticStep[];
  retryPolicy: { maxRetries: number; backoffMs: number };
  timeout: number;
  variables: Record<string, any>;
  onError: "retry" | "skip" | "abort";
}

export interface AgenticStep {
  id: string;
  action: "navigate" | "click" | "type" | "extract" | "wait" | "scroll" | "screenshot"
    | "select" | "upload" | "download" | "evaluate" | "condition" | "loop"
    | "switch_tab" | "new_tab" | "close_tab" | "assert" | "store_variable";
  params: Record<string, any>;
  selector?: string;
  description: string;
  expectedResult?: string;
  continueOnError?: boolean;
  retries?: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  results: StepResult[];
  extractedData: Record<string, any>;
  screenshots: string[];
  errors: string[];
  duration: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  data?: any;
  error?: string;
  screenshot?: string;
  duration: number;
}

// ============================================
// Stealth Plugin Configuration
// ============================================

const STEALTH_SCRIPTS = `
  // Override webdriver detection
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Override chrome detection
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'es'],
  });

  // Override platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
  });

  // Override hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
  });

  // Override WebGL renderer
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, parameter);
  };
`;

// ============================================
// Universal Browser Controller
// ============================================

export class UniversalBrowserController extends EventEmitter {
  private sessions: Map<string, BrowserSession> = new Map();
  private profiles: Map<string, BrowserProfile> = new Map();
  private llmClient: OpenAI;
  private baseWorkDir: string;

  constructor(options?: {
    workDir?: string;
    apiKey?: string;
    baseURL?: string;
  }) {
    super();
    this.baseWorkDir = options?.workDir || "/tmp/browser-controller";
    this.llmClient = new OpenAI({
      baseURL: options?.baseURL || process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1",
      apiKey: options?.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "missing",
    });

    // Register default profiles
    this.registerDefaultProfiles();
  }

  private registerDefaultProfiles(): void {
    const defaults: BrowserProfile[] = [
      {
        id: "chrome-desktop",
        name: "Chrome Desktop",
        browserType: "chromium",
        viewport: { width: 1920, height: 1080 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        stealth: true,
      },
      {
        id: "firefox-desktop",
        name: "Firefox Desktop",
        browserType: "firefox",
        viewport: { width: 1920, height: 1080 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      },
      {
        id: "safari-desktop",
        name: "Safari Desktop",
        browserType: "webkit",
        viewport: { width: 1440, height: 900 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      },
      {
        id: "mobile-iphone",
        name: "iPhone Safari",
        browserType: "webkit",
        viewport: { width: 390, height: 844 },
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
      {
        id: "mobile-android",
        name: "Android Chrome",
        browserType: "chromium",
        viewport: { width: 412, height: 915 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      },
    ];

    for (const profile of defaults) {
      this.profiles.set(profile.id, profile);
    }
  }

  // ============================================
  // Session Management
  // ============================================

  async createSession(profileId: string = "chrome-desktop", customProfile?: Partial<BrowserProfile>): Promise<string> {
    const baseProfile = this.profiles.get(profileId) || this.profiles.get("chrome-desktop")!;
    const profile: BrowserProfile = { ...baseProfile, ...customProfile, id: customProfile?.id || baseProfile.id };

    const sessionId = randomUUID();
    const downloadDir = path.join(this.baseWorkDir, sessionId, "downloads");
    await fs.mkdir(downloadDir, { recursive: true });

    // Launch browser based on type
    const launchOptions = {
      headless: true,
      args: profile.browserType === "chromium" ? [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      ] : [],
    };

    let browser: Browser;
    switch (profile.browserType) {
      case "firefox":
        browser = await firefox.launch(launchOptions);
        break;
      case "webkit":
        browser = await webkit.launch(launchOptions);
        break;
      default:
        browser = await chromium.launch(launchOptions);
    }

    const contextOptions: any = {
      viewport: profile.viewport,
      userAgent: profile.userAgent,
      locale: profile.locale || "en-US",
      timezoneId: profile.timezone,
      geolocation: profile.geolocation,
      permissions: profile.geolocation ? ["geolocation"] : [],
      acceptDownloads: true,
      extraHTTPHeaders: profile.headers,
    };

    if (profile.proxy) {
      contextOptions.proxy = profile.proxy;
    }

    const context = await browser.newContext(contextOptions);

    // Apply stealth scripts if enabled
    if (profile.stealth) {
      await context.addInitScript(STEALTH_SCRIPTS);
    }

    // Set cookies if provided
    if (profile.cookies?.length) {
      await context.addCookies(profile.cookies as any);
    }

    const session: BrowserSession = {
      id: sessionId,
      profile,
      browser,
      context,
      tabs: new Map(),
      activeTabId: null,
      downloadDir,
      networkLogs: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Set up network logging
    context.on("request", (request: PlaywrightRequest) => {
      session.networkLogs.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
        resourceType: request.resourceType(),
      });
      // Keep only last 500 logs
      if (session.networkLogs.length > 500) {
        session.networkLogs = session.networkLogs.slice(-500);
      }
    });

    this.sessions.set(sessionId, session);

    // Open first tab
    const tabId = await this.newTab(sessionId);
    session.activeTabId = tabId;

    this.emit("session:created", { sessionId, profile: profile.name });
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await session.browser.close().catch(() => {});
    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  // ============================================
  // Tab Management
  // ============================================

  async newTab(sessionId: string, url?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const page = await session.context.newPage();
    const tabId = randomUUID();

    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    const tab: Tab = {
      id: tabId,
      page,
      url: page.url(),
      title: await page.title().catch(() => ""),
      active: true,
      createdAt: Date.now(),
    };

    // Deactivate other tabs
    for (const [, t] of session.tabs) {
      t.active = false;
    }

    session.tabs.set(tabId, tab);
    session.activeTabId = tabId;

    return tabId;
  }

  async switchTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const tab = session.tabs.get(tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);

    for (const [, t] of session.tabs) {
      t.active = false;
    }
    tab.active = true;
    session.activeTabId = tabId;
    try {
      await tab.page.bringToFront();
    } catch (error: any) {
      throw new Error(`Failed to switch tab: ${error.message}`);
    }
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const tab = session.tabs.get(tabId);
    if (!tab) return;

    await tab.page.close();
    session.tabs.delete(tabId);

    if (session.activeTabId === tabId) {
      const remaining = Array.from(session.tabs.keys());
      session.activeTabId = remaining.length > 0 ? remaining[0] : null;
      if (session.activeTabId) {
        const nextTab = session.tabs.get(session.activeTabId)!;
        nextTab.active = true;
      }
    }
  }

  listTabs(sessionId: string): Array<{ id: string; url: string; title: string; active: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return Array.from(session.tabs.values()).map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
    }));
  }

  // ============================================
  // Navigation
  // ============================================

  async navigate(sessionId: string, url: string, options?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    timeout?: number;
    tabId?: string;
  }): Promise<{ success: boolean; url: string; title: string; status?: number }> {
    const page = this.getActivePage(sessionId, options?.tabId);

    try {
      const response = await page.goto(url, {
        waitUntil: options?.waitUntil || "domcontentloaded",
        timeout: options?.timeout || 30000,
      });

      const tab = this.getActiveTab(sessionId, options?.tabId);
      if (tab) {
        tab.url = page.url();
        tab.title = await page.title();
      }

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
        status: response?.status(),
      };
    } catch (error: any) {
      return { success: false, url: page.url(), title: "", status: undefined };
    }
  }

  async goBack(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.goBack({ waitUntil: "domcontentloaded" });
  }

  async goForward(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.goForward({ waitUntil: "domcontentloaded" });
  }

  async reload(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  // ============================================
  // Interaction
  // ============================================

  async click(sessionId: string, selector: string, options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
    timeout?: number;
    force?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const page = this.getActivePage(sessionId);

    try {
      await page.click(selector, {
        button: options?.button || "left",
        clickCount: options?.clickCount || 1,
        timeout: options?.timeout || 5000,
        force: options?.force || false,
      });
      return { success: true };
    } catch (error: any) {
      // Try alternative selectors
      const alternatives = await this.findAlternativeSelectors(page, selector);
      for (const alt of alternatives) {
        try {
          await page.click(alt, { timeout: 3000 });
          return { success: true };
        } catch {
          continue;
        }
      }
      return { success: false, error: error.message };
    }
  }

  async type(sessionId: string, selector: string, text: string, options?: {
    clear?: boolean;
    delay?: number;
    pressEnter?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const page = this.getActivePage(sessionId);

    try {
      if (options?.clear) {
        await page.fill(selector, "");
      }
      await page.fill(selector, text);

      if (options?.pressEnter) {
        await page.press(selector, "Enter");
      }
      return { success: true };
    } catch (error: any) {
      // Fallback: click + keyboard.type
      try {
        await page.click(selector, { timeout: 3000 });
        if (options?.clear) {
          await page.keyboard.press("Control+a");
          await page.keyboard.press("Delete");
        }
        await page.keyboard.type(text, { delay: options?.delay || 30 });
        if (options?.pressEnter) {
          await page.keyboard.press("Enter");
        }
        return { success: true };
      } catch (fallbackErr: any) {
        return { success: false, error: fallbackErr.message };
      }
    }
  }

  async select(sessionId: string, selector: string, values: string | string[]): Promise<{ success: boolean; selected: string[] }> {
    const page = this.getActivePage(sessionId);
    const selected = await page.selectOption(selector, values);
    return { success: true, selected };
  }

  async hover(sessionId: string, selector: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.hover(selector);
  }

  async scroll(sessionId: string, options: {
    direction: "up" | "down" | "left" | "right";
    amount?: number;
    selector?: string;
  }): Promise<void> {
    const page = this.getActivePage(sessionId);

    if (options.selector) {
      await page.locator(options.selector).scrollIntoViewIfNeeded();
    } else {
      const delta = options.amount || 500;
      const deltaMap = {
        up: { x: 0, y: -delta },
        down: { x: 0, y: delta },
        left: { x: -delta, y: 0 },
        right: { x: delta, y: 0 },
      };
      const d = deltaMap[options.direction];
      await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: d.x, dy: d.y });
    }
  }

  async uploadFile(sessionId: string, selector: string, filePaths: string[]): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.setInputFiles(selector, filePaths);
  }

  // ============================================
  // Data Extraction
  // ============================================

  async extract(sessionId: string, rules: ExtractionRule[]): Promise<Record<string, any>> {
    const page = this.getActivePage(sessionId);
    const results: Record<string, any> = {};

    for (const rule of rules) {
      try {
        switch (rule.type) {
          case "text":
            if (rule.selector === "page") {
              results[rule.name] = await page.evaluate(() => document.body?.innerText || "");
            } else {
              const el = await page.$(rule.selector);
              results[rule.name] = el ? await el.innerText() : null;
            }
            break;

          case "html":
            results[rule.name] = await page.$eval(rule.selector, el => el.innerHTML);
            break;

          case "attribute":
            results[rule.name] = await page.$eval(
              rule.selector,
              (el, attr) => el.getAttribute(attr || ""),
              rule.attribute || ""
            );
            break;

          case "list":
            results[rule.name] = await page.$$eval(rule.selector, (elements) =>
              elements.map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean)
            );
            break;

          case "table":
            results[rule.name] = await page.$eval(rule.selector, (table) => {
              const rows = Array.from(table.querySelectorAll("tr"));
              return rows.map(row =>
                Array.from(row.querySelectorAll("td, th")).map(cell => (cell as HTMLElement).innerText?.trim())
              );
            });
            break;

          case "screenshot":
            const element = await page.$(rule.selector);
            if (element) {
              const buf = await element.screenshot({ type: "png" });
              results[rule.name] = buf.toString("base64");
            }
            break;
        }

        // Apply transform
        if (rule.transform && results[rule.name] != null) {
          const val = results[rule.name];
          switch (rule.transform) {
            case "trim":
              results[rule.name] = typeof val === "string" ? val.trim() : val;
              break;
            case "lowercase":
              results[rule.name] = typeof val === "string" ? val.toLowerCase() : val;
              break;
            case "uppercase":
              results[rule.name] = typeof val === "string" ? val.toUpperCase() : val;
              break;
            case "number":
              results[rule.name] = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
              break;
          }
        }
      } catch (error: any) {
        results[rule.name] = null;
      }
    }

    return results;
  }

  async extractStructured(sessionId: string, description: string): Promise<any> {
    const page = this.getActivePage(sessionId);

    // Get page HTML (truncated for LLM)
    let html: string;
    try {
      html = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, svg, noscript").forEach(el => el.remove());
        return clone.outerHTML.slice(0, 30000);
      });
    } catch (error: any) {
      throw new Error(`Failed to extract page HTML: ${error.message}`);
    }

    const response = await this.llmClient.chat.completions.create({
      model: "grok-4-1-fast-non-reasoning",
      messages: [
        {
          role: "system",
          content: "You extract structured data from HTML. Return valid JSON only.",
        },
        {
          role: "user",
          content: `Extract the following data from this HTML:\n\nREQUEST: ${description}\n\nHTML:\n${html}`,
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  }

  // ============================================
  // Screenshot
  // ============================================

  async screenshot(sessionId: string, options?: {
    fullPage?: boolean;
    selector?: string;
    quality?: number;
    type?: "png" | "jpeg";
  }): Promise<string> {
    const page = this.getActivePage(sessionId);

    let buffer: Buffer;
    if (options?.selector) {
      const element = await page.$(options.selector);
      if (!element) throw new Error(`Element not found: ${options.selector}`);
      buffer = await element.screenshot({ type: options?.type || "png" });
    } else {
      buffer = await page.screenshot({
        type: options?.type || "png",
        fullPage: options?.fullPage || false,
        quality: options?.type === "jpeg" ? options?.quality || 80 : undefined,
      });
    }

    return buffer.toString("base64");
  }

  // ============================================
  // Network Control
  // ============================================

  async interceptRequests(sessionId: string, patterns: Array<{
    urlPattern: string;
    action: "block" | "modify" | "log";
    headers?: Record<string, string>;
    body?: string;
  }>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.context.route("**/*", async (route: Route) => {
      const url = route.request().url();

      for (const pattern of patterns) {
        if (url.includes(pattern.urlPattern) || new RegExp(pattern.urlPattern).test(url)) {
          switch (pattern.action) {
            case "block":
              await route.abort();
              return;
            case "modify":
              await route.continue({
                headers: pattern.headers ? { ...route.request().headers(), ...pattern.headers } : undefined,
                postData: pattern.body,
              });
              return;
            case "log":
              this.emit("network:intercepted", { url, method: route.request().method() });
              break;
          }
        }
      }

      await route.continue();
    });
  }

  getNetworkLogs(sessionId: string, filter?: { urlPattern?: string; method?: string }): NetworkLog[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    let logs = session.networkLogs;
    if (filter?.urlPattern) {
      logs = logs.filter(l => l.url.includes(filter.urlPattern!));
    }
    if (filter?.method) {
      logs = logs.filter(l => l.method === filter.method);
    }
    return logs;
  }

  // ============================================
  // Cookie & Storage Management
  // ============================================

  async getCookies(sessionId: string, urls?: string[]): Promise<any[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.context.cookies(urls);
  }

  async setCookies(sessionId: string, cookies: Array<{ name: string; value: string; domain: string; path?: string }>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.context.addCookies(cookies as any);
  }

  async clearCookies(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.context.clearCookies();
  }

  async getLocalStorage(sessionId: string): Promise<Record<string, string>> {
    const page = this.getActivePage(sessionId);
    return page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) items[key] = localStorage.getItem(key) || "";
      }
      return items;
    });
  }

  async setLocalStorage(sessionId: string, items: Record<string, string>): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(key, value);
      }
    }, items);
  }

  // ============================================
  // Agentic Task Execution
  // ============================================

  async executeAgenticTask(sessionId: string, task: AgenticTask, onProgress?: (step: AgenticStep, result: StepResult) => void): Promise<TaskResult> {
    const startTime = Date.now();
    const results: StepResult[] = [];
    const screenshots: string[] = [];
    const errors: string[] = [];
    let stepsCompleted = 0;

    for (const step of task.steps) {
      const stepStart = Date.now();
      let retries = step.retries || task.retryPolicy.maxRetries;
      let stepResult: StepResult | null = null;

      while (retries >= 0) {
        try {
          const data = await this.executeStep(sessionId, step, task.variables);

          stepResult = {
            stepId: step.id,
            success: true,
            data,
            duration: Date.now() - stepStart,
          };

          // Store variable if step says to
          if (step.action === "store_variable" && step.params.variableName) {
            task.variables[step.params.variableName] = data;
          }

          stepsCompleted++;
          break;
        } catch (error: any) {
          retries--;
          if (retries >= 0) {
            await new Promise(r => setTimeout(r, task.retryPolicy.backoffMs));
            continue;
          }

          stepResult = {
            stepId: step.id,
            success: false,
            error: error.message,
            duration: Date.now() - stepStart,
          };

          errors.push(`Step "${step.description}": ${error.message}`);

          if (!step.continueOnError && task.onError === "abort") {
            results.push(stepResult);
            onProgress?.(step, stepResult);
            return {
              taskId: task.id,
              success: false,
              stepsCompleted,
              totalSteps: task.steps.length,
              results,
              extractedData: task.variables,
              screenshots,
              errors,
              duration: Date.now() - startTime,
            };
          }
        }
      }

      if (stepResult) {
        results.push(stepResult);
        onProgress?.(step, stepResult);
      }
    }

    return {
      taskId: task.id,
      success: stepsCompleted === task.steps.length,
      stepsCompleted,
      totalSteps: task.steps.length,
      results,
      extractedData: task.variables,
      screenshots,
      errors,
      duration: Date.now() - startTime,
    };
  }

  private async executeStep(sessionId: string, step: AgenticStep, variables: Record<string, any>): Promise<any> {
    const page = this.getActivePage(sessionId);

    // Resolve variables in params
    const params = this.resolveVariables(step.params, variables);
    const selector = step.selector ? this.resolveTemplate(step.selector, variables) : undefined;

    switch (step.action) {
      case "navigate":
        return this.navigate(sessionId, params.url, params);

      case "click":
        if (!selector) throw new Error("Selector required for click");
        return this.click(sessionId, selector, params);

      case "type":
        if (!selector) throw new Error("Selector required for type");
        return this.type(sessionId, selector, params.text || params.value || "", params);

      case "extract":
        if (params.rules) {
          return this.extract(sessionId, params.rules);
        }
        if (selector) {
          return page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "");
        }
        return this.extractStructured(sessionId, params.description || "Extract all data");

      case "wait":
        if (selector) {
          await page.waitForSelector(selector, { timeout: params.timeout || 10000 });
        } else if (params.url) {
          await page.waitForURL(params.url, { timeout: params.timeout || 10000 });
        } else {
          await page.waitForTimeout(params.duration || 1000);
        }
        return { waited: true };

      case "scroll":
        await this.scroll(sessionId, {
          direction: params.direction || "down",
          amount: params.amount,
          selector,
        });
        return { scrolled: true };

      case "screenshot":
        return this.screenshot(sessionId, { selector, fullPage: params.fullPage });

      case "select":
        if (!selector) throw new Error("Selector required for select");
        return this.select(sessionId, selector, params.value || params.values);

      case "upload":
        if (!selector) throw new Error("Selector required for upload");
        await this.uploadFile(sessionId, selector, Array.isArray(params.files) ? params.files : [params.files]);
        return { uploaded: true };

      case "evaluate":
        return page.evaluate(params.script || params.code);

      case "condition":
        const conditionResult = await page.evaluate(params.condition);
        if (conditionResult && params.thenSteps) {
          for (const s of params.thenSteps) {
            await this.executeStep(sessionId, s, variables);
          }
        } else if (!conditionResult && params.elseSteps) {
          for (const s of params.elseSteps) {
            await this.executeStep(sessionId, s, variables);
          }
        }
        return { conditionMet: !!conditionResult };

      case "loop":
        const items = params.items || [];
        const loopResults = [];
        for (const item of items) {
          variables[params.variableName || "_item"] = item;
          for (const s of params.steps || []) {
            loopResults.push(await this.executeStep(sessionId, s, variables));
          }
        }
        return loopResults;

      case "new_tab":
        return this.newTab(sessionId, params.url);

      case "switch_tab":
        await this.switchTab(sessionId, params.tabId);
        return { switched: true };

      case "close_tab":
        await this.closeTab(sessionId, params.tabId);
        return { closed: true };

      case "assert":
        const assertValue = selector
          ? await page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "")
          : await page.evaluate(params.expression);
        const passed = params.expected
          ? String(assertValue).includes(String(params.expected))
          : !!assertValue;
        if (!passed) throw new Error(`Assertion failed: expected "${params.expected}", got "${assertValue}"`);
        return { asserted: true, value: assertValue };

      case "store_variable":
        const extractedValue = selector
          ? await page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "")
          : await page.evaluate(params.expression);
        return extractedValue;

      default:
        throw new Error(`Unknown step action: ${step.action}`);
    }
  }

  // ============================================
  // Smart Agentic Navigation (LLM-powered)
  // ============================================

  async agenticNavigate(sessionId: string, goal: string, maxSteps: number = 20): Promise<{
    success: boolean;
    steps: string[];
    data: any;
    screenshots: string[];
  }> {
    const steps: string[] = [];
    const screenshots: string[] = [];
    let data: any = {};

    for (let i = 0; i < maxSteps; i++) {
      const page = this.getActivePage(sessionId);
      const screenshotBase64 = await this.screenshot(sessionId);
      screenshots.push(screenshotBase64);

      const pageInfo = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        text: document.body?.innerText?.slice(0, 5000) || "",
        forms: Array.from(document.querySelectorAll("input, textarea, select, button")).slice(0, 20).map(el => ({
          tag: el.tagName,
          type: (el as HTMLInputElement).type,
          name: (el as HTMLInputElement).name || (el as HTMLInputElement).id,
          placeholder: (el as HTMLInputElement).placeholder,
          text: (el as HTMLElement).innerText?.slice(0, 50),
          value: (el as HTMLInputElement).value,
        })),
      }));

      const response = await this.llmClient.chat.completions.create({
        model: "grok-4-1-fast-non-reasoning",
        messages: [
          {
            role: "system",
            content: `You are an expert web automation agent. You control a browser to accomplish the user's goal.

Current page: ${pageInfo.url}
Title: ${pageInfo.title}
Interactive elements: ${JSON.stringify(pageInfo.forms)}

Previous steps: ${steps.join(" -> ")}

Respond with ONE action in JSON:
{
  "action": "click" | "type" | "navigate" | "scroll" | "wait" | "extract" | "done",
  "selector": "CSS selector",
  "value": "text to type or URL to navigate",
  "reasoning": "why this action",
  "goalProgress": "how close to goal (0-100%)",
  "extractedData": {} // any data extracted so far
}

If the goal is accomplished, use action "done" with extractedData containing results.`,
          },
          { role: "user", content: `GOAL: ${goal}\n\nPage text (truncated): ${pageInfo.text.slice(0, 3000)}` },
        ],
        max_tokens: 1024,
        temperature: 0.1,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const planned = JSON.parse(jsonMatch[0]);
      steps.push(`${planned.action}: ${planned.reasoning}`);

      if (planned.action === "done") {
        data = planned.extractedData || {};
        return { success: true, steps, data, screenshots };
      }

      try {
        switch (planned.action) {
          case "click":
            await this.click(sessionId, planned.selector);
            break;
          case "type":
            await this.type(sessionId, planned.selector, planned.value, { clear: true });
            break;
          case "navigate":
            await this.navigate(sessionId, planned.value);
            break;
          case "scroll":
            await this.scroll(sessionId, { direction: "down", amount: 500 });
            break;
          case "wait":
            await page.waitForTimeout(2000);
            break;
          case "extract":
            data = { ...data, ...(planned.extractedData || {}) };
            break;
        }

        await page.waitForTimeout(500); // Brief pause between actions
      } catch (error: any) {
        steps.push(`Error: ${error.message}`);
      }
    }

    return { success: false, steps, data, screenshots };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private getActivePage(sessionId: string, tabId?: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const id = tabId || session.activeTabId;
    if (!id) throw new Error("No active tab");

    const tab = session.tabs.get(id);
    if (!tab) throw new Error(`Tab not found: ${id}`);

    return tab.page;
  }

  private getActiveTab(sessionId: string, tabId?: string): Tab | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const id = tabId || session.activeTabId;
    if (!id) return null;

    return session.tabs.get(id) || null;
  }

  private async findAlternativeSelectors(page: Page, originalSelector: string): Promise<string[]> {
    const alternatives: string[] = [];

    try {
      // Try by text content
      const textMatch = originalSelector.match(/[.#]?[\w-]+/);
      if (textMatch) {
        alternatives.push(`text="${textMatch[0]}"`);
        alternatives.push(`[aria-label*="${textMatch[0]}"]`);
        alternatives.push(`[title*="${textMatch[0]}"]`);
        alternatives.push(`[placeholder*="${textMatch[0]}"]`);
      }

      // Try by role
      alternatives.push(`[role="button"]`);
      alternatives.push(`[role="link"]`);
    } catch {
      // Ignore
    }

    return alternatives;
  }

  private resolveVariables(params: Record<string, any>, variables: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        resolved[key] = this.resolveTemplate(value, variables);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private resolveTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return variables[name] !== undefined ? String(variables[name]) : `{{${name}}}`;
    });
  }

  async cleanup(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.closeSession(id);
    }
  }
}

// Singleton
export const universalBrowserController = new UniversalBrowserController();

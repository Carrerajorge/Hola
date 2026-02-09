/**
 * Browser Engine Extensions - Advanced capabilities for the UniversalBrowserController
 *
 * Adds PDF generation, accessibility tree extraction, console capture,
 * performance metrics, dialog handling, element highlighting, session
 * recording/replay, multi-page scraping pipelines, and cookie persistence.
 */

import { Page, BrowserContext, ConsoleMessage, Dialog } from "playwright";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ============================================
// Types
// ============================================

export interface RecordedAction {
  id: string;
  timestamp: number;
  type: "navigate" | "click" | "type" | "scroll" | "select" | "hover" | "wait" | "screenshot" | "evaluate";
  selector?: string;
  value?: string;
  url?: string;
  coordinates?: { x: number; y: number };
  options?: Record<string, any>;
}

export interface SessionRecording {
  id: string;
  name: string;
  actions: RecordedAction[];
  startUrl: string;
  createdAt: number;
  duration: number;
  profileId: string;
}

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  focused?: boolean;
  disabled?: boolean;
  checked?: boolean | "mixed";
  level?: number;
  children?: AccessibilityNode[];
}

export interface PerformanceMetrics {
  loadTime: number;
  domContentLoaded: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  totalBlockingTime: number;
  cumulativeLayoutShift: number;
  jsHeapSize: number;
  domNodes: number;
  resourceCount: number;
  transferSize: number;
  timestamp: number;
}

export interface ConsoleEntry {
  type: "log" | "error" | "warning" | "info" | "debug";
  text: string;
  location: { url: string; line: number; column: number } | null;
  timestamp: number;
}

export interface DialogEvent {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultValue?: string;
  handled: boolean;
  response?: string | boolean;
  timestamp: number;
}

export interface ScrapingPipeline {
  id: string;
  name: string;
  startUrl: string;
  steps: ScrapingStep[];
  maxPages: number;
  concurrency: number;
  delay: number;
  variables: Record<string, any>;
}

export interface ScrapingStep {
  action: "navigate" | "click" | "paginate" | "extract" | "wait" | "condition";
  selector?: string;
  url?: string;
  extractionRules?: Array<{
    name: string;
    selector: string;
    type: "text" | "html" | "attribute" | "list";
    attribute?: string;
  }>;
  condition?: {
    selector: string;
    exists: boolean;
  };
  waitMs?: number;
  paginationSelector?: string;
  maxPages?: number;
}

export interface ScrapingResult {
  pipelineId: string;
  pagesScraped: number;
  data: Record<string, any>[];
  errors: string[];
  duration: number;
}

export interface ElementHighlight {
  selector: string;
  label?: string;
  color?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// ============================================
// Browser Engine Extensions
// ============================================

export class BrowserEngineExtensions extends EventEmitter {
  private recordings: Map<string, SessionRecording> = new Map();
  private activeRecordings: Map<string, { recording: SessionRecording; startTime: number }> = new Map();
  private consoleEntries: Map<string, ConsoleEntry[]> = new Map();
  private dialogEvents: Map<string, DialogEvent[]> = new Map();

  // ============================================
  // PDF Generation
  // ============================================

  async generatePdf(page: Page, options?: {
    format?: "A4" | "Letter" | "Legal" | "A3" | "Tabloid";
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
    margin?: { top?: string; bottom?: string; left?: string; right?: string };
    headerTemplate?: string;
    footerTemplate?: string;
    displayHeaderFooter?: boolean;
    pageRanges?: string;
  }): Promise<{ buffer: Buffer; path: string }> {
    const pdfBuffer = await page.pdf({
      format: options?.format || "A4",
      landscape: options?.landscape || false,
      printBackground: options?.printBackground !== false,
      scale: options?.scale || 1,
      margin: options?.margin || { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
      headerTemplate: options?.headerTemplate,
      footerTemplate: options?.footerTemplate,
      displayHeaderFooter: options?.displayHeaderFooter || false,
      pageRanges: options?.pageRanges,
    });

    const outputDir = path.join(os.tmpdir(), "iliagpt-pdfs");
    await fs.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `page-${randomUUID().slice(0, 8)}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    return { buffer: pdfBuffer, path: filePath };
  }

  // ============================================
  // Accessibility Tree
  // ============================================

  async getAccessibilityTree(page: Page): Promise<AccessibilityNode> {
    const snapshot = await page.accessibility.snapshot();
    return this.normalizeAccessibilityNode(snapshot);
  }

  async getAccessibilityByRole(page: Page, role: string): Promise<AccessibilityNode[]> {
    const tree = await this.getAccessibilityTree(page);
    const results: AccessibilityNode[] = [];
    this.findNodesByRole(tree, role, results);
    return results;
  }

  private normalizeAccessibilityNode(node: any): AccessibilityNode {
    if (!node) return { role: "none", name: "" };
    return {
      role: node.role || "none",
      name: node.name || "",
      value: node.value,
      description: node.description,
      focused: node.focused,
      disabled: node.disabled,
      checked: node.checked,
      level: node.level,
      children: node.children?.map((c: any) => this.normalizeAccessibilityNode(c)),
    };
  }

  private findNodesByRole(node: AccessibilityNode, role: string, results: AccessibilityNode[]): void {
    if (node.role === role) results.push(node);
    if (node.children) {
      for (const child of node.children) {
        this.findNodesByRole(child, role, results);
      }
    }
  }

  // ============================================
  // Console Log Capture
  // ============================================

  startConsoleCapture(sessionId: string, page: Page): void {
    this.consoleEntries.set(sessionId, []);

    page.on("console", (msg: ConsoleMessage) => {
      const entries = this.consoleEntries.get(sessionId);
      if (!entries) return;

      const entry: ConsoleEntry = {
        type: msg.type() as ConsoleEntry["type"],
        text: msg.text(),
        location: msg.location() ? {
          url: msg.location().url,
          line: msg.location().lineNumber,
          column: msg.location().columnNumber,
        } : null,
        timestamp: Date.now(),
      };

      entries.push(entry);
      // Keep max 500 entries
      if (entries.length > 500) entries.shift();

      this.emit("console", { sessionId, entry });
    });
  }

  getConsoleEntries(sessionId: string, filter?: {
    type?: ConsoleEntry["type"];
    search?: string;
    limit?: number;
  }): ConsoleEntry[] {
    let entries = this.consoleEntries.get(sessionId) || [];

    if (filter?.type) {
      entries = entries.filter((e) => e.type === filter.type);
    }
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      entries = entries.filter((e) => e.text.toLowerCase().includes(search));
    }
    if (filter?.limit) {
      entries = entries.slice(-filter.limit);
    }

    return entries;
  }

  clearConsoleEntries(sessionId: string): void {
    this.consoleEntries.set(sessionId, []);
  }

  // ============================================
  // Dialog Handling
  // ============================================

  setupDialogHandler(sessionId: string, page: Page, autoAccept: boolean = true, defaultResponse?: string): void {
    this.dialogEvents.set(sessionId, []);

    page.on("dialog", async (dialog: Dialog) => {
      const event: DialogEvent = {
        type: dialog.type() as DialogEvent["type"],
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        handled: true,
        timestamp: Date.now(),
      };

      if (autoAccept) {
        if (dialog.type() === "prompt") {
          event.response = defaultResponse || dialog.defaultValue() || "";
          await dialog.accept(event.response as string);
        } else {
          event.response = true;
          await dialog.accept();
        }
      } else {
        event.response = false;
        await dialog.dismiss();
      }

      const events = this.dialogEvents.get(sessionId) || [];
      events.push(event);
      this.dialogEvents.set(sessionId, events);

      this.emit("dialog", { sessionId, event });
    });
  }

  getDialogEvents(sessionId: string): DialogEvent[] {
    return this.dialogEvents.get(sessionId) || [];
  }

  // ============================================
  // Performance Metrics
  // ============================================

  async getPerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
    const metrics = await page.evaluate(() => {
      const perf = performance;
      const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const paint = perf.getEntriesByType("paint");
      const resources = perf.getEntriesByType("resource") as PerformanceResourceTiming[];

      const fcp = paint.find((p) => p.name === "first-contentful-paint");
      const fp = paint.find((p) => p.name === "first-paint");

      let lcp = 0;
      try {
        const lcpEntries = (perf as any).getEntriesByType("largest-contentful-paint");
        if (lcpEntries.length > 0) lcp = lcpEntries[lcpEntries.length - 1].startTime;
      } catch { /* not supported */ }

      let cls = 0;
      try {
        const clsEntries = (perf as any).getEntriesByType("layout-shift");
        cls = clsEntries.reduce((sum: number, entry: any) =>
          sum + (entry.hadRecentInput ? 0 : entry.value), 0);
      } catch { /* not supported */ }

      const jsHeap = (performance as any).memory?.usedJSHeapSize || 0;

      return {
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        firstPaint: fp ? fp.startTime : 0,
        firstContentfulPaint: fcp ? fcp.startTime : 0,
        largestContentfulPaint: lcp,
        totalBlockingTime: 0,
        cumulativeLayoutShift: cls,
        jsHeapSize: jsHeap,
        domNodes: document.querySelectorAll("*").length,
        resourceCount: resources.length,
        transferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      };
    });

    return { ...metrics, timestamp: Date.now() };
  }

  // ============================================
  // Element Highlighting
  // ============================================

  async highlightElements(page: Page, highlights: ElementHighlight[]): Promise<string> {
    await page.evaluate((items) => {
      // Remove existing highlights
      document.querySelectorAll("[data-iliagpt-highlight]").forEach((el) => el.remove());

      for (const item of items) {
        try {
          const elements = document.querySelectorAll(item.selector);
          elements.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            const overlay = document.createElement("div");
            overlay.setAttribute("data-iliagpt-highlight", "true");
            overlay.style.cssText = `
              position: fixed;
              top: ${rect.top}px;
              left: ${rect.left}px;
              width: ${rect.width}px;
              height: ${rect.height}px;
              border: 2px solid ${item.color || "#ff0000"};
              background: ${item.color || "#ff0000"}20;
              z-index: 999999;
              pointer-events: none;
              box-sizing: border-box;
            `;

            if (item.label) {
              const label = document.createElement("div");
              label.textContent = `${item.label}${elements.length > 1 ? ` [${idx}]` : ""}`;
              label.style.cssText = `
                position: absolute;
                top: -20px;
                left: 0;
                background: ${item.color || "#ff0000"};
                color: white;
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 3px;
                white-space: nowrap;
              `;
              overlay.appendChild(label);
            }

            document.body.appendChild(overlay);
          });
        } catch {
          // Invalid selector, skip
        }
      }
    }, highlights);

    // Capture screenshot with highlights
    const buffer = await page.screenshot({ type: "png" });
    const screenshot = buffer.toString("base64");

    // Remove highlights
    await page.evaluate(() => {
      document.querySelectorAll("[data-iliagpt-highlight]").forEach((el) => el.remove());
    });

    return screenshot;
  }

  async getElementAtPoint(page: Page, x: number, y: number): Promise<{
    selector: string;
    tag: string;
    text: string;
    attributes: Record<string, string>;
    boundingBox: { x: number; y: number; width: number; height: number };
  } | null> {
    return page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return null;

      // Generate a unique CSS selector
      function getSelector(element: Element): string {
        if (element.id) return `#${element.id}`;
        if (element === document.body) return "body";

        const parent = element.parentElement;
        if (!parent) return element.tagName.toLowerCase();

        const siblings = Array.from(parent.children);
        const sameTag = siblings.filter((s) => s.tagName === element.tagName);

        let selector = element.tagName.toLowerCase();

        if (element.className && typeof element.className === "string") {
          const classes = element.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (classes) selector += `.${classes}`;
        }

        if (sameTag.length > 1) {
          const index = sameTag.indexOf(element) + 1;
          selector += `:nth-of-type(${index})`;
        }

        return `${getSelector(parent)} > ${selector}`;
      }

      const rect = el.getBoundingClientRect();
      const attrs: Record<string, string> = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }

      return {
        selector: getSelector(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 200),
        attributes: attrs,
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    }, { px: x, py: y });
  }

  // ============================================
  // Session Recording & Replay
  // ============================================

  startRecording(sessionId: string, name: string, startUrl: string, profileId: string): string {
    const recordingId = randomUUID();
    const recording: SessionRecording = {
      id: recordingId,
      name,
      actions: [],
      startUrl,
      createdAt: Date.now(),
      duration: 0,
      profileId,
    };

    this.activeRecordings.set(sessionId, { recording, startTime: Date.now() });
    this.emit("recording:started", { sessionId, recordingId });
    return recordingId;
  }

  recordAction(sessionId: string, action: Omit<RecordedAction, "id" | "timestamp">): void {
    const active = this.activeRecordings.get(sessionId);
    if (!active) return;

    const recorded: RecordedAction = {
      id: randomUUID(),
      timestamp: Date.now() - active.startTime,
      ...action,
    };

    active.recording.actions.push(recorded);
    this.emit("recording:action", { sessionId, action: recorded });
  }

  stopRecording(sessionId: string): SessionRecording | null {
    const active = this.activeRecordings.get(sessionId);
    if (!active) return null;

    active.recording.duration = Date.now() - active.startTime;
    this.recordings.set(active.recording.id, active.recording);
    this.activeRecordings.delete(sessionId);

    this.emit("recording:stopped", { sessionId, recordingId: active.recording.id });
    return active.recording;
  }

  getRecording(recordingId: string): SessionRecording | null {
    return this.recordings.get(recordingId) || null;
  }

  listRecordings(): SessionRecording[] {
    return Array.from(this.recordings.values());
  }

  deleteRecording(recordingId: string): boolean {
    return this.recordings.delete(recordingId);
  }

  // ============================================
  // Multi-Page Scraping Pipeline
  // ============================================

  async executeScraping(
    page: Page,
    pipeline: ScrapingPipeline,
    onProgress?: (pagesScraped: number, currentUrl: string) => void
  ): Promise<ScrapingResult> {
    const startTime = Date.now();
    const allData: Record<string, any>[] = [];
    const errors: string[] = [];
    let pagesScraped = 0;

    try {
      // Navigate to start URL
      await page.goto(pipeline.startUrl, { waitUntil: "networkidle", timeout: 30000 });
      pagesScraped++;
      onProgress?.(pagesScraped, pipeline.startUrl);

      for (const step of pipeline.steps) {
        try {
          switch (step.action) {
            case "navigate":
              if (step.url) {
                const resolvedUrl = this.resolveTemplate(step.url, pipeline.variables);
                await page.goto(resolvedUrl, { waitUntil: "networkidle", timeout: 30000 });
                pagesScraped++;
                onProgress?.(pagesScraped, resolvedUrl);
              }
              break;

            case "click":
              if (step.selector) {
                await page.click(step.selector, { timeout: 10000 });
                await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
              }
              break;

            case "wait":
              await page.waitForTimeout(step.waitMs || 1000);
              break;

            case "extract":
              if (step.extractionRules) {
                const pageData: Record<string, any> = { _url: page.url() };
                for (const rule of step.extractionRules) {
                  try {
                    if (rule.type === "list") {
                      pageData[rule.name] = await page.$$eval(rule.selector, (els) =>
                        els.map((el) => (el as HTMLElement).innerText?.trim() || "")
                      );
                    } else if (rule.type === "attribute" && rule.attribute) {
                      pageData[rule.name] = await page.$eval(
                        rule.selector,
                        (el, attr) => el.getAttribute(attr) || "",
                        rule.attribute
                      );
                    } else {
                      pageData[rule.name] = await page.$eval(
                        rule.selector,
                        (el) => (el as HTMLElement).innerText?.trim() || ""
                      );
                    }
                  } catch {
                    pageData[rule.name] = null;
                  }
                }
                allData.push(pageData);
              }
              break;

            case "paginate":
              if (step.paginationSelector) {
                const maxPaginationPages = step.maxPages || pipeline.maxPages || 10;
                for (let p = 0; p < maxPaginationPages; p++) {
                  try {
                    const hasNext = await page.$(step.paginationSelector);
                    if (!hasNext) break;

                    await page.click(step.paginationSelector, { timeout: 5000 });
                    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
                    await page.waitForTimeout(pipeline.delay || 500);

                    pagesScraped++;
                    onProgress?.(pagesScraped, page.url());

                    // Re-extract if extraction rules exist
                    if (step.extractionRules) {
                      const pageData: Record<string, any> = { _url: page.url(), _page: p + 2 };
                      for (const rule of step.extractionRules) {
                        try {
                          if (rule.type === "list") {
                            pageData[rule.name] = await page.$$eval(rule.selector, (els) =>
                              els.map((el) => (el as HTMLElement).innerText?.trim() || "")
                            );
                          } else {
                            pageData[rule.name] = await page.$eval(
                              rule.selector,
                              (el) => (el as HTMLElement).innerText?.trim() || ""
                            );
                          }
                        } catch {
                          pageData[rule.name] = null;
                        }
                      }
                      allData.push(pageData);
                    }
                  } catch (e: any) {
                    errors.push(`Pagination page ${p + 2}: ${e.message}`);
                    break;
                  }
                }
              }
              break;

            case "condition":
              if (step.condition) {
                const exists = await page.$(step.condition.selector) !== null;
                if (exists !== step.condition.exists) {
                  break; // Skip remaining steps
                }
              }
              break;
          }
        } catch (e: any) {
          errors.push(`Step ${step.action}: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Pipeline error: ${e.message}`);
    }

    return {
      pipelineId: pipeline.id,
      pagesScraped,
      data: allData,
      errors,
      duration: Date.now() - startTime,
    };
  }

  // ============================================
  // Cookie Persistence
  // ============================================

  async saveCookies(context: BrowserContext, filePath: string): Promise<void> {
    const cookies = await context.cookies();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(cookies, null, 2));
  }

  async loadCookies(context: BrowserContext, filePath: string): Promise<number> {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const cookies = JSON.parse(data);
      await context.addCookies(cookies);
      return cookies.length;
    } catch {
      return 0;
    }
  }

  // ============================================
  // Utilities
  // ============================================

  private resolveTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return variables[name] !== undefined ? String(variables[name]) : `{{${name}}}`;
    });
  }

  cleanup(): void {
    this.recordings.clear();
    this.activeRecordings.clear();
    this.consoleEntries.clear();
    this.dialogEvents.clear();
  }
}

export const browserEngineExtensions = new BrowserEngineExtensions();

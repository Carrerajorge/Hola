import { chromium, Browser, Page, BrowserContext } from "playwright";
import crypto from "crypto";
import net from "net";

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

class BrowserWorker {
  private sessions: Map<string, BrowserSession> = new Map();
  private browser: Browser | null = null;

  private isBlockedHostname(hostname: string): boolean {
    const lowered = hostname.toLowerCase();
    return (
      lowered === "localhost" ||
      lowered.endsWith(".localhost") ||
      lowered.endsWith(".local") ||
      lowered.endsWith(".internal")
    );
  }

  private isPrivateIp(ip: string): boolean {
    if (net.isIP(ip) === 4) {
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4) return true;
      const [a, b] = parts;
      return (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      );
    }
    if (net.isIP(ip) === 6) {
      const normalized = ip.toLowerCase();
      return (
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80")
      );
    }
    return false;
  }

  private assertSafeUrl(rawUrl: string): URL {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http/https URLs are allowed.");
    }

    if (this.isBlockedHostname(parsed.hostname)) {
      throw new Error("Blocked host.");
    }

    if (net.isIP(parsed.hostname) && this.isPrivateIp(parsed.hostname)) {
      throw new Error("Blocked private IP address.");
    }

    if (parsed.hostname === "169.254.169.254") {
      throw new Error("Blocked metadata host.");
    }

    return parsed;
  }

  async initialize(): Promise<void> {
    if (this.browser) return;
    
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080"
        ]
      });
      console.log("Browser worker initialized");
    } catch (error) {
      console.error("Failed to initialize browser:", error);
      throw error;
    }
  }

  async createSession(): Promise<string> {
    await this.initialize();
    
    const sessionId = crypto.randomUUID();
    const context = await this.browser!.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    
    const page = await context.newPage();
    
    this.sessions.set(sessionId, {
      id: sessionId,
      browser: this.browser!,
      context,
      page,
      createdAt: new Date()
    });

    return sessionId;
  }

  async navigate(sessionId: string, url: string, takeScreenshot: boolean = true): Promise<NavigationResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const startTime = Date.now();
    
    try {
      this.assertSafeUrl(url);
      await session.page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000
      });
      
      const navigationTime = Date.now() - startTime;
      
      await session.page.waitForLoadState("domcontentloaded");
      const renderTime = Date.now() - startTime - navigationTime;
      
      const title = await session.page.title();
      const html = await session.page.content();
      
      let screenshot: Buffer | undefined;
      if (takeScreenshot) {
        screenshot = await session.page.screenshot({ 
          type: "png",
          fullPage: false 
        });
      }

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

    try {
      await session.page.fill(selector, text, { timeout: 10000 });
      return { success: true, selector };
    } catch (error: any) {
      return { success: false, selector, error: error.message };
    }
  }

  async pressKey(sessionId: string, key: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

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
      return await session.page.screenshot({ 
        type: "png", 
        fullPage 
      });
    } catch {
      return null;
    }
  }

  async getHtml(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      return await session.page.content();
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
      await session.context.close();
    } catch (e) {
      console.error("Error closing session:", e);
    }
    
    this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<void> {
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

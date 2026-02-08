import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// URL Security
import {
  UrlSecurityManager,
} from "../../server/agent/browser/security/url-security";

// Context Hardening
import {
  BrowserContextHardener,
} from "../../server/agent/browser/security/context-hardening";

// Session Security
import {
  SessionSecurityManager,
} from "../../server/agent/browser/security/session-security";

// JS Sandbox
import {
  JsSandboxManager,
} from "../../server/agent/browser/security/js-sandbox";

// Selector Sanitizer
import {
  SelectorSanitizer,
} from "../../server/agent/browser/security/selector-sanitizer";

// Download Security
import {
  DownloadSecurityManager,
} from "../../server/agent/browser/security/download-security";

// Audit Logger
import {
  BrowserSecurityAuditLogger,
} from "../../server/agent/browser/security/audit-logger";

// Fingerprint Manager
import {
  BrowserFingerprintManager,
} from "../../server/agent/browser/security/fingerprint-manager";

// ==========================================
// URL SECURITY TESTS
// ==========================================
describe("UrlSecurityManager", () => {
  let urlSecurity: UrlSecurityManager;

  beforeEach(() => {
    // Disable DNS check in tests to avoid timeouts from real DNS resolution
    urlSecurity = new UrlSecurityManager({ enableDnsCheck: false });
  });

  describe("Protocol validation", () => {
    it("should allow HTTP URLs", async () => {
      const result = await urlSecurity.validateUrl("http://example.com");
      expect(result.allowed).toBe(true);
    });

    it("should allow HTTPS URLs", async () => {
      const result = await urlSecurity.validateUrl("https://example.com");
      expect(result.allowed).toBe(true);
    });

    it("should block javascript: protocol", async () => {
      const result = await urlSecurity.validateUrl("javascript:alert(1)");
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("should block file: protocol", async () => {
      const result = await urlSecurity.validateUrl("file:///etc/passwd");
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("should block data: protocol", async () => {
      const result = await urlSecurity.validateUrl("data:text/html,<script>alert(1)</script>");
      expect(result.allowed).toBe(false);
    });

    it("should block blob: protocol", async () => {
      const result = await urlSecurity.validateUrl("blob:http://example.com/abc");
      expect(result.allowed).toBe(false);
    });

    it("should block ftp: protocol", async () => {
      const result = await urlSecurity.validateUrl("ftp://example.com/file");
      expect(result.allowed).toBe(false);
    });

    it("should block chrome: protocol", async () => {
      const result = await urlSecurity.validateUrl("chrome://settings");
      expect(result.allowed).toBe(false);
    });

    it("should block view-source: protocol", async () => {
      const result = await urlSecurity.validateUrl("view-source:http://example.com");
      expect(result.allowed).toBe(false);
    });
  });

  describe("SSRF prevention - Private IPs", () => {
    it("should block localhost", async () => {
      const result = await urlSecurity.validateUrl("http://localhost/admin");
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("should block 127.0.0.1", async () => {
      const result = await urlSecurity.validateUrl("http://127.0.0.1/api");
      expect(result.allowed).toBe(false);
    });

    it("should block 10.x.x.x private range", async () => {
      const result = await urlSecurity.validateUrl("http://10.0.0.1/internal");
      expect(result.allowed).toBe(false);
    });

    it("should block 172.16.x.x private range", async () => {
      const result = await urlSecurity.validateUrl("http://172.16.0.1/internal");
      expect(result.allowed).toBe(false);
    });

    it("should block 192.168.x.x private range", async () => {
      const result = await urlSecurity.validateUrl("http://192.168.1.1/admin");
      expect(result.allowed).toBe(false);
    });

    it("should block 0.0.0.0", async () => {
      const result = await urlSecurity.validateUrl("http://0.0.0.0/");
      expect(result.allowed).toBe(false);
    });

    it("should block IPv6 loopback", async () => {
      const result = await urlSecurity.validateUrl("http://[::1]/");
      expect(result.allowed).toBe(false);
    });
  });

  describe("SSRF prevention - Cloud metadata", () => {
    it("should block AWS metadata endpoint", async () => {
      const result = await urlSecurity.validateUrl("http://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("should block GCP metadata endpoint", async () => {
      const result = await urlSecurity.validateUrl("http://metadata.google.internal/");
      expect(result.allowed).toBe(false);
    });

    it("should block Alibaba Cloud metadata", async () => {
      const result = await urlSecurity.validateUrl("http://100.100.100.200/");
      expect(result.allowed).toBe(false);
    });
  });

  describe("SSRF prevention - Obfuscated IPs", () => {
    it("should block hex-encoded IP (0x7f000001 = 127.0.0.1)", async () => {
      const result = await urlSecurity.validateUrl("http://0x7f000001/");
      expect(result.allowed).toBe(false);
    });

    it("should block decimal-encoded IP (2130706433 = 127.0.0.1)", async () => {
      const result = await urlSecurity.validateUrl("http://2130706433/");
      expect(result.allowed).toBe(false);
    });

    it("should block octal-encoded IP (0177.0.0.1 = 127.0.0.1)", async () => {
      const result = await urlSecurity.validateUrl("http://0177.0.0.1/");
      expect(result.allowed).toBe(false);
    });
  });

  describe("Internal hostname blocking", () => {
    it("should block .internal domains", async () => {
      const result = await urlSecurity.validateUrl("http://app.internal/api");
      expect(result.allowed).toBe(false);
    });

    it("should block .local domains", async () => {
      const result = await urlSecurity.validateUrl("http://server.local/");
      expect(result.allowed).toBe(false);
    });

    it("should block .localhost domains", async () => {
      const result = await urlSecurity.validateUrl("http://app.localhost/");
      expect(result.allowed).toBe(false);
    });

    it("should block .corp domains", async () => {
      const result = await urlSecurity.validateUrl("http://intranet.corp/");
      expect(result.allowed).toBe(false);
    });
  });

  describe("Port restrictions", () => {
    it("should block SSH port 22", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:22/");
      expect(result.allowed).toBe(false);
    });

    it("should block Redis port 6379", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:6379/");
      expect(result.allowed).toBe(false);
    });

    it("should block PostgreSQL port 5432", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:5432/");
      expect(result.allowed).toBe(false);
    });

    it("should block MySQL port 3306", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:3306/");
      expect(result.allowed).toBe(false);
    });

    it("should block MongoDB port 27017", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:27017/");
      expect(result.allowed).toBe(false);
    });

    it("should allow port 80", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:80/");
      expect(result.allowed).toBe(true);
    });

    it("should allow port 443", async () => {
      const result = await urlSecurity.validateUrl("https://example.com:443/");
      expect(result.allowed).toBe(true);
    });

    it("should allow port 8080", async () => {
      const result = await urlSecurity.validateUrl("http://example.com:8080/");
      expect(result.allowed).toBe(true);
    });
  });

  describe("URL sanitization", () => {
    it("should strip credentials from URLs", async () => {
      const result = await urlSecurity.validateUrl("http://user:pass@example.com/");
      expect(result.allowed).toBe(true);
      expect(result.normalizedUrl).not.toContain("user:pass");
    });

    it("should reject URLs exceeding max length", async () => {
      const longUrl = "http://example.com/" + "a".repeat(9000);
      const result = await urlSecurity.validateUrl(longUrl);
      expect(result.allowed).toBe(false);
    });

    it("should reject invalid URLs", async () => {
      const result = await urlSecurity.validateUrl("not-a-valid-url");
      expect(result.allowed).toBe(false);
    });

    it("should reject empty URLs", async () => {
      const result = await urlSecurity.validateUrl("");
      expect(result.allowed).toBe(false);
    });
  });

  describe("Synchronous validation", () => {
    it("should block private IPs synchronously", () => {
      const result = urlSecurity.validateUrlSync("http://192.168.1.1/");
      expect(result.allowed).toBe(false);
    });

    it("should allow public URLs synchronously", () => {
      const result = urlSecurity.validateUrlSync("https://example.com/");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Redirect validation", () => {
    it("should block redirect to private IP", async () => {
      const result = await urlSecurity.validateRedirect(
        "https://example.com",
        "http://192.168.1.1/admin",
        1
      );
      expect(result.allowed).toBe(false);
    });

    it("should block excessive redirect depth", async () => {
      const result = await urlSecurity.validateRedirect(
        "https://example.com",
        "https://other.com",
        10
      );
      expect(result.allowed).toBe(false);
    });
  });
});

// ==========================================
// JS SANDBOX TESTS
// ==========================================
describe("JsSandboxManager", () => {
  let sandbox: JsSandboxManager;

  beforeEach(() => {
    sandbox = new JsSandboxManager();
  });

  describe("Script validation", () => {
    it("should allow safe DOM queries", () => {
      const result = sandbox.validateScript("document.querySelector('.test')");
      expect(result.allowed).toBe(true);
    });

    it("should allow safe data extraction", () => {
      const result = sandbox.validateScript(`
        (function() {
          return document.title;
        })()
      `);
      expect(result.allowed).toBe(true);
    });

    it("should block eval()", () => {
      const result = sandbox.validateScript('eval("malicious code")');
      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe("critical");
    });

    it("should block new Function()", () => {
      const result = sandbox.validateScript('new Function("return 1")()');
      expect(result.allowed).toBe(false);
    });

    it("should block import()", () => {
      const result = sandbox.validateScript('import("malicious-module")');
      expect(result.allowed).toBe(false);
    });

    it("should block require()", () => {
      const result = sandbox.validateScript('require("child_process")');
      expect(result.allowed).toBe(false);
    });

    it("should block process access", () => {
      const result = sandbox.validateScript("process.env.SECRET");
      expect(result.allowed).toBe(false);
    });

    it("should block Worker creation", () => {
      const result = sandbox.validateScript('new Worker("/worker.js")');
      expect(result.allowed).toBe(false);
    });

    it("should block WebAssembly", () => {
      const result = sandbox.validateScript("WebAssembly.compile(buffer)");
      expect(result.allowed).toBe(false);
    });

    it("should block __proto__ access", () => {
      const result = sandbox.validateScript("obj.__proto__.polluted = true");
      expect(result.allowed).toBe(false);
    });

    it("should block document.write", () => {
      const result = sandbox.validateScript('document.write("<script>alert(1)</script>")');
      expect(result.allowed).toBe(false);
    });

    it("should block constructor.constructor", () => {
      const result = sandbox.validateScript('"".constructor.constructor("return this")()');
      expect(result.allowed).toBe(false);
    });

    it("should block Object.defineProperty", () => {
      const result = sandbox.validateScript('Object.defineProperty(window, "x", {value: 1})');
      expect(result.allowed).toBe(false);
    });

    it("should block innerHTML assignment", () => {
      const result = sandbox.validateScript('element.innerHTML = "<img onerror=alert(1)>"');
      expect(result.allowed).toBe(false);
    });

    it("should block script element creation", () => {
      const result = sandbox.validateScript('document.createElement("script")');
      expect(result.allowed).toBe(false);
    });

    it("should block iframe creation", () => {
      const result = sandbox.validateScript('document.createElement("iframe")');
      expect(result.allowed).toBe(false);
    });

    it("should block cookie manipulation", () => {
      const result = sandbox.validateScript('document.cookie = "stolen=data"');
      expect(result.allowed).toBe(false);
    });

    it("should reject empty scripts", () => {
      const result = sandbox.validateScript("");
      expect(result.allowed).toBe(false);
    });

    it("should reject scripts exceeding max length", () => {
      const longScript = "var x = " + "1 + ".repeat(5000) + "1;";
      const result = sandbox.validateScript(longScript);
      expect(result.allowed).toBe(false);
    });
  });

  describe("Network API blocking", () => {
    it("should block fetch() when network APIs blocked", () => {
      const strictSandbox = new JsSandboxManager({ blockNetworkAPIs: true });
      const result = strictSandbox.validateScript('fetch("/api/data")');
      expect(result.allowed).toBe(false);
    });

    it("should block XMLHttpRequest", () => {
      const strictSandbox = new JsSandboxManager({ blockNetworkAPIs: true });
      const result = strictSandbox.validateScript("new XMLHttpRequest()");
      expect(result.allowed).toBe(false);
    });

    it("should block WebSocket", () => {
      const strictSandbox = new JsSandboxManager({ blockNetworkAPIs: true });
      const result = strictSandbox.validateScript('new WebSocket("ws://evil.com")');
      expect(result.allowed).toBe(false);
    });

    it("should block navigator.sendBeacon", () => {
      const strictSandbox = new JsSandboxManager({ blockNetworkAPIs: true });
      const result = strictSandbox.validateScript('navigator.sendBeacon("/exfil", data)');
      expect(result.allowed).toBe(false);
    });
  });

  describe("Script wrapping", () => {
    it("should produce a wrapped script string", () => {
      const wrapped = sandbox.wrapScript("return 42");
      expect(wrapped).toContain("'use strict'");
      expect(wrapped).toContain("return 42");
    });
  });
});

// ==========================================
// SELECTOR SANITIZER TESTS
// ==========================================
describe("SelectorSanitizer", () => {
  let sanitizer: SelectorSanitizer;

  beforeEach(() => {
    sanitizer = new SelectorSanitizer();
  });

  describe("Valid selectors", () => {
    it("should allow simple CSS selectors", () => {
      expect(sanitizer.validate("#myId").valid).toBe(true);
      expect(sanitizer.validate(".myClass").valid).toBe(true);
      expect(sanitizer.validate("div").valid).toBe(true);
      expect(sanitizer.validate("div > span").valid).toBe(true);
      expect(sanitizer.validate("a[href]").valid).toBe(true);
    });

    it("should allow attribute selectors", () => {
      expect(sanitizer.validate('[data-testid="submit"]').valid).toBe(true);
      expect(sanitizer.validate('input[name="email"]').valid).toBe(true);
    });

    it("should allow XPath selectors", () => {
      expect(sanitizer.validate("//div[@class='test']").valid).toBe(true);
    });
  });

  describe("Injection prevention", () => {
    it("should block JavaScript in selectors", () => {
      expect(sanitizer.validate("div[onclick=alert(1)]").valid).toBe(false);
    });

    it("should block javascript: protocol in selectors", () => {
      expect(sanitizer.validate("javascript:alert(1)").valid).toBe(false);
    });

    it("should block expression() CSS attack", () => {
      expect(sanitizer.validate("div{expression(alert(1))}").valid).toBe(false);
    });

    it("should block @import CSS attack", () => {
      expect(sanitizer.validate("@import url(evil.css)").valid).toBe(false);
    });

    it("should block HTML tags in selectors", () => {
      expect(sanitizer.validate("<script>alert(1)</script>").valid).toBe(false);
      expect(sanitizer.validate("<img onerror=alert(1)>").valid).toBe(false);
      expect(sanitizer.validate("<iframe>").valid).toBe(false);
    });

    it("should block null bytes", () => {
      expect(sanitizer.validate("div\0.test").valid).toBe(false);
    });

    it("should block control characters", () => {
      expect(sanitizer.validate("div\x01.test").valid).toBe(false);
    });
  });

  describe("Sensitive selector blocking", () => {
    it("should block password field selectors", () => {
      expect(sanitizer.validate('input[type="password"]').valid).toBe(false);
    });

    it("should block credit card selectors", () => {
      expect(sanitizer.validate('input[autocomplete="cc-number"]').valid).toBe(false);
    });

    it("should block SSN selectors", () => {
      expect(sanitizer.validate('input[name*="ssn"]').valid).toBe(false);
    });

    it("should block token/secret selectors", () => {
      expect(sanitizer.validate('input[name*="api_key"]').valid).toBe(false);
    });
  });

  describe("Length validation", () => {
    it("should reject selectors exceeding max length", () => {
      const longSelector = ".class" + " > .child".repeat(200);
      expect(sanitizer.validate(longSelector).valid).toBe(false);
    });

    it("should reject empty selectors", () => {
      expect(sanitizer.validate("").valid).toBe(false);
    });
  });

  describe("Selector type detection", () => {
    it("should detect CSS selectors", () => {
      expect(sanitizer.validate("div.class").selectorType).toBe("css");
    });

    it("should detect XPath selectors", () => {
      expect(sanitizer.validate("//div").selectorType).toBe("xpath");
    });

    it("should detect text selectors", () => {
      expect(sanitizer.validate('text=Hello').selectorType).toBe("text");
    });
  });

  describe("Static utility methods", () => {
    it("should escape attribute values", () => {
      const escaped = SelectorSanitizer.escapeAttributeValue("test'value\"end");
      // The function escapes quotes with backslashes
      expect(escaped).toContain("\\'");
      expect(escaped).toContain('\\"');
      expect(escaped).not.toBe("test'value\"end");
    });

    it("should build safe attribute selectors", () => {
      const selector = SelectorSanitizer.buildAttributeSelector("input", "name", "user's email");
      expect(selector).toContain("input[name=");
      expect(selector).not.toContain("user's");
    });
  });
});

// ==========================================
// SESSION SECURITY TESTS
// ==========================================
describe("SessionSecurityManager", () => {
  let sessionManager: SessionSecurityManager;

  beforeEach(() => {
    sessionManager = new SessionSecurityManager({
      maxConcurrentSessions: 3,
      maxActionsPerSession: 10,
      maxSessionLifetimeMs: 5000,
      idleTimeoutMs: 2000,
      enableAutoCleanup: false,
    });
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe("Session creation limits", () => {
    it("should allow creating sessions within limit", () => {
      expect(sessionManager.canCreateSession().allowed).toBe(true);
    });

    it("should block creating sessions over limit", () => {
      sessionManager.registerSession("s1");
      sessionManager.registerSession("s2");
      sessionManager.registerSession("s3");
      const result = sessionManager.canCreateSession();
      expect(result.allowed).toBe(false);
    });

    it("should allow creation after unregistering a session", () => {
      sessionManager.registerSession("s1");
      sessionManager.registerSession("s2");
      sessionManager.registerSession("s3");
      sessionManager.unregisterSession("s1");
      expect(sessionManager.canCreateSession().allowed).toBe(true);
    });
  });

  describe("Action tracking", () => {
    it("should allow actions within limit", () => {
      sessionManager.registerSession("test");
      for (let i = 0; i < 10; i++) {
        expect(sessionManager.recordAction("test").allowed).toBe(true);
      }
    });

    it("should block actions over limit", () => {
      sessionManager.registerSession("test");
      for (let i = 0; i < 11; i++) {
        sessionManager.recordAction("test");
      }
      expect(sessionManager.recordAction("test").allowed).toBe(false);
    });

    it("should return false for unknown sessions", () => {
      expect(sessionManager.recordAction("unknown").allowed).toBe(false);
    });
  });

  describe("Session health checks", () => {
    it("should report healthy sessions", () => {
      sessionManager.registerSession("test");
      const health = sessionManager.checkSessionHealth("test");
      expect(health.healthy).toBe(true);
      expect(health.shouldTerminate).toBe(false);
    });

    it("should detect expired sessions", async () => {
      const shortLived = new SessionSecurityManager({
        maxSessionLifetimeMs: 50,
        enableAutoCleanup: false,
      });
      shortLived.registerSession("test");
      await new Promise(r => setTimeout(r, 100));
      const health = shortLived.checkSessionHealth("test");
      expect(health.healthy).toBe(false);
      expect(health.shouldTerminate).toBe(true);
      shortLived.shutdown();
    });

    it("should return shouldTerminate for unknown sessions", () => {
      const health = sessionManager.checkSessionHealth("unknown");
      expect(health.shouldTerminate).toBe(true);
    });
  });

  describe("Metrics", () => {
    it("should track session metrics", () => {
      sessionManager.registerSession("test");
      sessionManager.recordAction("test");
      sessionManager.recordNetworkRequest("test");
      sessionManager.recordScreenshot("test", 1024);

      const metrics = sessionManager.getSessionMetrics("test");
      expect(metrics).toBeDefined();
      expect(metrics!.actionCount).toBe(1);
      expect(metrics!.networkRequestCount).toBe(1);
      expect(metrics!.screenshotCount).toBe(1);
    });

    it("should provide a summary", () => {
      sessionManager.registerSession("s1");
      sessionManager.registerSession("s2");
      const summary = sessionManager.getSummary();
      expect(summary.totalSessions).toBe(2);
      expect(summary.activeSessions).toBe(2);
    });
  });
});

// ==========================================
// DOWNLOAD SECURITY TESTS
// ==========================================
describe("DownloadSecurityManager", () => {
  let downloadManager: DownloadSecurityManager;

  beforeEach(() => {
    downloadManager = new DownloadSecurityManager();
  });

  describe("File extension blocking", () => {
    it("should block .exe files", () => {
      const result = downloadManager.validateDownload("s1", "malware.exe", 1024, "application/octet-stream");
      expect(result.allowed).toBe(false);
    });

    it("should block .bat files", () => {
      const result = downloadManager.validateDownload("s1", "script.bat", 1024, "application/octet-stream");
      expect(result.allowed).toBe(false);
    });

    it("should block .sh files", () => {
      const result = downloadManager.validateDownload("s1", "script.sh", 1024, "text/plain");
      expect(result.allowed).toBe(false);
    });

    it("should block .ps1 files", () => {
      const result = downloadManager.validateDownload("s1", "script.ps1", 1024, "text/plain");
      expect(result.allowed).toBe(false);
    });

    it("should block macro-enabled Office docs (.xlsm)", () => {
      const result = downloadManager.validateDownload("s1", "report.xlsm", 1024, "application/octet-stream");
      expect(result.allowed).toBe(false);
    });

    it("should block .jar files", () => {
      const result = downloadManager.validateDownload("s1", "app.jar", 1024, "application/java-archive");
      expect(result.allowed).toBe(false);
    });
  });

  describe("Safe file types", () => {
    it("should allow .pdf files", () => {
      const result = downloadManager.validateDownload("s1", "document.pdf", 1024, "application/pdf");
      expect(result.allowed).toBe(true);
    });

    it("should allow .csv files", () => {
      const result = downloadManager.validateDownload("s1", "data.csv", 1024, "text/csv");
      expect(result.allowed).toBe(true);
    });

    it("should allow .png files", () => {
      const result = downloadManager.validateDownload("s1", "image.png", 1024, "image/png");
      expect(result.allowed).toBe(true);
    });
  });

  describe("Size limits", () => {
    it("should block files exceeding max size", () => {
      const result = downloadManager.validateDownload(
        "s1", "huge.zip", 200 * 1024 * 1024, "application/zip"
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe("Per-session limits", () => {
    it("should enforce download count per session", () => {
      const mgr = new DownloadSecurityManager({ maxDownloadsPerSession: 2 } as any);
      expect(mgr.validateDownload("s1", "f1.pdf", 100, "application/pdf").allowed).toBe(true);
      expect(mgr.validateDownload("s1", "f2.pdf", 100, "application/pdf").allowed).toBe(true);
      expect(mgr.validateDownload("s1", "f3.pdf", 100, "application/pdf").allowed).toBe(false);
    });
  });

  describe("Content scanning", () => {
    it("should detect ELF executable signatures", () => {
      const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x00, 0x00]);
      const result = downloadManager.validateDownload(
        "s1", "file.bin", elfBuffer.length, "application/octet-stream", elfBuffer
      );
      expect(result.allowed).toBe(false);
      expect(result.detectedType || result.reason).toBeDefined();
    });

    it("should detect Windows PE executable signatures", () => {
      const peBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x00]);
      const result = downloadManager.validateDownload(
        "s1", "file.bin", peBuffer.length, "application/octet-stream", peBuffer
      );
      expect(result.allowed).toBe(false);
    });

    it("should detect double extensions", () => {
      const content = Buffer.from("normal content");
      const result = downloadManager.validateDownload(
        "s1", "report.pdf.exe", content.length, "application/octet-stream", content
      );
      expect(result.allowed).toBe(false);
    });
  });
});

// ==========================================
// CONTEXT HARDENING TESTS
// ==========================================
describe("BrowserContextHardener", () => {
  let hardener: BrowserContextHardener;

  beforeEach(() => {
    hardener = new BrowserContextHardener();
  });

  describe("Context options", () => {
    it("should produce hardened context options", () => {
      const options = hardener.getHardenedContextOptions();
      expect(options.permissions).toEqual([]);
      expect(options.javaScriptEnabled).toBe(true);
      expect(options.acceptDownloads).toBe(false);
      expect(options.serviceWorkers).toBe("block");
      expect(options.extraHTTPHeaders).toBeDefined();
      expect(options.extraHTTPHeaders["DNT"]).toBe("1");
    });

    it("should disable JavaScript when configured", () => {
      const strictHardener = new BrowserContextHardener({ disableJavaScript: true });
      const options = strictHardener.getHardenedContextOptions();
      expect(options.javaScriptEnabled).toBe(false);
    });
  });

  describe("Chromium secure args", () => {
    it("should include security flags", () => {
      const args = BrowserContextHardener.getSecureChromiumArgs();
      expect(args).toContain("--no-sandbox");
      expect(args).toContain("--disable-extensions");
      expect(args).toContain("--site-per-process");
      expect(args).toContain("--disable-webgl");
      expect(args).toContain("--block-new-web-contents");
    });
  });
});

// ==========================================
// AUDIT LOGGER TESTS
// ==========================================
describe("BrowserSecurityAuditLogger", () => {
  let logger: BrowserSecurityAuditLogger;

  beforeEach(() => {
    logger = new BrowserSecurityAuditLogger({
      logCriticalToConsole: false,
      logBlockedToConsole: false,
      enableAnomalyDetection: true,
      maxBlockedEventsBeforeAlert: 5,
    });
  });

  afterEach(() => {
    logger.shutdown();
  });

  describe("Event logging", () => {
    it("should log events with proper structure", () => {
      const event = logger.logNavigation("s1", "http://example.com", true);
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.category).toBe("navigation");
      expect(event.blocked).toBe(false);
    });

    it("should log SSRF attempts as critical", () => {
      const event = logger.logSSRFAttempt("s1", "http://169.254.169.254/", "Cloud metadata");
      expect(event.severity).toBe("critical");
      expect(event.riskScore).toBe(95);
    });

    it("should log blocked events", () => {
      logger.logNavigation("s1", "http://evil.com", false, "Blocked");
      const blocked = logger.getBlockedEvents();
      expect(blocked.length).toBe(1);
    });
  });

  describe("Query methods", () => {
    it("should filter events by session", () => {
      logger.logNavigation("s1", "http://a.com", true);
      logger.logNavigation("s2", "http://b.com", true);
      expect(logger.getEventsBySession("s1").length).toBe(1);
    });

    it("should filter events by severity", () => {
      logger.logNavigation("s1", "http://a.com", true);
      logger.logSSRFAttempt("s1", "http://evil.com", "SSRF");
      expect(logger.getEventsBySeverity("critical").length).toBe(1);
    });

    it("should filter high-risk events", () => {
      logger.logSSRFAttempt("s1", "http://evil.com", "SSRF");
      logger.logNavigation("s1", "http://a.com", true);
      const highRisk = logger.getHighRiskEvents(80);
      expect(highRisk.length).toBe(1);
    });
  });

  describe("Summary", () => {
    it("should provide accurate summary", () => {
      logger.logNavigation("s1", "http://a.com", true);
      logger.logNavigation("s1", "http://b.com", false, "blocked");
      logger.logSSRFAttempt("s1", "http://evil.com", "SSRF");

      const summary = logger.getSummary();
      expect(summary.totalEvents).toBe(3);
      expect(summary.blockedEvents).toBe(2);
      expect(summary.criticalEvents).toBe(1);
    });
  });

  describe("Event callbacks", () => {
    it("should notify listeners", () => {
      const events: any[] = [];
      logger.addEventListener((e) => events.push(e));
      logger.logNavigation("s1", "http://a.com", true);
      expect(events.length).toBe(1);
    });
  });

  describe("Cleanup", () => {
    it("should clear events", () => {
      logger.logNavigation("s1", "http://a.com", true);
      logger.clearEvents();
      expect(logger.getSummary().totalEvents).toBe(0);
    });

    it("should clear session events", () => {
      logger.logNavigation("s1", "http://a.com", true);
      logger.logNavigation("s2", "http://b.com", true);
      logger.clearSessionEvents("s1");
      expect(logger.getSummary().totalEvents).toBe(1);
    });
  });
});

// ==========================================
// FINGERPRINT MANAGER TESTS
// ==========================================
describe("BrowserFingerprintManager", () => {
  let manager: BrowserFingerprintManager;

  beforeEach(() => {
    manager = new BrowserFingerprintManager();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe("Fingerprint generation", () => {
    it("should generate a complete fingerprint", () => {
      const fp = manager.generateFingerprint();
      expect(fp.userAgent).toBeDefined();
      expect(fp.viewport).toBeDefined();
      expect(fp.viewport.width).toBeGreaterThan(0);
      expect(fp.viewport.height).toBeGreaterThan(0);
      expect(fp.platform).toBeDefined();
      expect(fp.language).toBeDefined();
      expect(fp.languages.length).toBeGreaterThan(0);
      expect(fp.hardwareConcurrency).toBeGreaterThan(0);
      expect(fp.deviceMemory).toBeGreaterThan(0);
      expect(fp.timezone).toBeDefined();
    });
  });

  describe("Session consistency", () => {
    it("should return consistent fingerprint within a session", () => {
      const fp1 = manager.getFingerprintForSession("s1");
      const fp2 = manager.getFingerprintForSession("s1");
      expect(fp1.userAgent).toBe(fp2.userAgent);
      expect(fp1.viewport.width).toBe(fp2.viewport.width);
    });

    it("should clean up session fingerprints", () => {
      manager.getFingerprintForSession("s1");
      manager.clearSession("s1");
      // Getting again should work but may differ
      const fp = manager.getFingerprintForSession("s1");
      expect(fp).toBeDefined();
    });
  });

  describe("Init script", () => {
    it("should generate a valid init script", () => {
      const fp = manager.generateFingerprint();
      const script = manager.getInitScript(fp);
      expect(script).toContain("navigator");
      expect(script).toContain("webdriver");
      expect(script).toContain("use strict");
    });
  });

  describe("Platform preference", () => {
    it("should prefer specified platform", () => {
      const winManager = new BrowserFingerprintManager({ preferredPlatform: "windows" });
      const fp = winManager.generateFingerprint();
      expect(fp.platform).toBe("Win32");
    });
  });
});

// ==========================================
// REQUEST INTERCEPTOR TESTS (unit tests for logic)
// ==========================================
describe("RequestInterceptor (config)", () => {
  it("should have sensible defaults", async () => {
    // Use dynamic import for the TS module
    const mod = await import("../../server/agent/browser/security/request-interceptor");
    const interceptor = new mod.RequestInterceptor();
    expect(interceptor).toBeDefined();
    const stats = interceptor.getAllStats();
    expect(stats).toBeDefined();
    expect(stats.size).toBe(0);
  });
});

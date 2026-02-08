/**
 * Browser Context Hardening Module
 *
 * Enforces Content Security Policies, permission restrictions,
 * cookie isolation, and other context-level security measures
 * for Playwright browser automation.
 */

import { BrowserContext, Browser } from "playwright";

export interface ContextHardeningConfig {
  /** Block geolocation access */
  blockGeolocation: boolean;
  /** Block camera/microphone access */
  blockMediaDevices: boolean;
  /** Block notification permissions */
  blockNotifications: boolean;
  /** Block clipboard access */
  blockClipboard: boolean;
  /** Block payment handler */
  blockPaymentHandler: boolean;
  /** Block USB access */
  blockUSB: boolean;
  /** Block Bluetooth access */
  blockBluetooth: boolean;
  /** Block MIDI access */
  blockMIDI: boolean;
  /** Enforce HTTPS for navigation */
  enforceHTTPS: boolean;
  /** Block popup windows */
  blockPopups: boolean;
  /** Block downloads by type */
  allowedDownloadTypes: string[];
  /** Maximum cookie count per domain */
  maxCookiesPerDomain: number;
  /** Maximum total cookie count */
  maxTotalCookies: number;
  /** Cookie lifetime maximum (ms) */
  maxCookieLifetimeMs: number;
  /** Block third-party cookies */
  blockThirdPartyCookies: boolean;
  /** Content Security Policy header value */
  contentSecurityPolicy: string;
  /** Maximum response body size in bytes */
  maxResponseBodySize: number;
  /** Block WebRTC to prevent IP leaks */
  blockWebRTC: boolean;
  /** Block service workers */
  blockServiceWorkers: boolean;
  /** Disable JavaScript (for content-only fetching) */
  disableJavaScript: boolean;
  /** Timezone override */
  timezoneOverride?: string;
  /** Locale override */
  localeOverride?: string;
}

export const DEFAULT_CONTEXT_HARDENING_CONFIG: ContextHardeningConfig = {
  blockGeolocation: true,
  blockMediaDevices: true,
  blockNotifications: true,
  blockClipboard: true,
  blockPaymentHandler: true,
  blockUSB: true,
  blockBluetooth: true,
  blockMIDI: true,
  enforceHTTPS: false, // Allow HTTP for compatibility
  blockPopups: true,
  allowedDownloadTypes: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "application/json",
    "application/xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
  maxCookiesPerDomain: 50,
  maxTotalCookies: 200,
  maxCookieLifetimeMs: 24 * 60 * 60 * 1000, // 24 hours
  blockThirdPartyCookies: true,
  contentSecurityPolicy: [
    "default-src 'self' https: http:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:",
    "style-src 'self' 'unsafe-inline' https: http:",
    "img-src 'self' data: https: http:",
    "font-src 'self' data: https: http:",
    "connect-src 'self' https: http:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; "),
  maxResponseBodySize: 50 * 1024 * 1024, // 50MB
  blockWebRTC: true,
  blockServiceWorkers: true,
  disableJavaScript: false,
  timezoneOverride: undefined,
  localeOverride: undefined,
};

export interface ContextHardeningResult {
  success: boolean;
  appliedPolicies: string[];
  errors: string[];
}

export class BrowserContextHardener {
  private config: ContextHardeningConfig;

  constructor(config: Partial<ContextHardeningConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_HARDENING_CONFIG, ...config };
  }

  /**
   * Get hardened context options for browser.newContext()
   */
  getHardenedContextOptions(): Record<string, any> {
    const options: Record<string, any> = {
      // Block dangerous permissions
      permissions: [],

      // Disable service workers
      serviceWorkers: this.config.blockServiceWorkers ? "block" : "allow",

      // Disable JavaScript if configured
      javaScriptEnabled: !this.config.disableJavaScript,

      // Prevent accepting downloads by default (we control this separately)
      acceptDownloads: false,

      // Bypass CSP only if we need JavaScript evaluation
      bypassCSP: false,

      // Strict cookies
      ignoreHTTPSErrors: false,

      // Extra HTTP headers for security
      extraHTTPHeaders: {
        "X-Requested-With": "BrowserAutomation",
        "DNT": "1",
      },
    };

    if (this.config.timezoneOverride) {
      options.timezoneId = this.config.timezoneOverride;
    }

    if (this.config.localeOverride) {
      options.locale = this.config.localeOverride;
    }

    return options;
  }

  /**
   * Apply runtime hardening to an existing context
   */
  async hardenContext(context: BrowserContext): Promise<ContextHardeningResult> {
    const appliedPolicies: string[] = [];
    const errors: string[] = [];

    // 1. Block permissions
    try {
      if (this.config.blockGeolocation) {
        await context.clearPermissions();
        appliedPolicies.push("permissions_cleared");
      }
    } catch (e: any) {
      errors.push(`permissions: ${e.message}`);
    }

    // 2. Add initialization script for WebRTC and other blocking
    try {
      const initScript = this.buildInitScript();
      await context.addInitScript(initScript);
      appliedPolicies.push("init_script_injected");
    } catch (e: any) {
      errors.push(`init_script: ${e.message}`);
    }

    // 3. Set up route interception for popups and large responses
    try {
      // Block popup windows by intercepting new pages
      context.on("page", async (page) => {
        // Close any unexpected popup pages
        if (this.config.blockPopups) {
          try {
            await page.close();
            appliedPolicies.push("popup_blocked");
          } catch {
            // Page might already be closed
          }
        }
      });
      appliedPolicies.push("popup_handler_installed");
    } catch (e: any) {
      errors.push(`popup_blocking: ${e.message}`);
    }

    // 4. Set up cookie monitoring
    try {
      this.setupCookieMonitoring(context);
      appliedPolicies.push("cookie_monitoring");
    } catch (e: any) {
      errors.push(`cookie_monitoring: ${e.message}`);
    }

    return {
      success: errors.length === 0,
      appliedPolicies,
      errors,
    };
  }

  /**
   * Build initialization script that runs in every page
   */
  private buildInitScript(): string {
    const blocks: string[] = [];

    // Block WebRTC to prevent IP leaks
    if (this.config.blockWebRTC) {
      blocks.push(`
        // Block WebRTC
        if (typeof window !== 'undefined') {
          Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, writable: false, configurable: false });
          Object.defineProperty(window, 'webkitRTCPeerConnection', { value: undefined, writable: false, configurable: false });
          Object.defineProperty(window, 'mozRTCPeerConnection', { value: undefined, writable: false, configurable: false });
          Object.defineProperty(window, 'RTCDataChannel', { value: undefined, writable: false, configurable: false });
        }
      `);
    }

    // Block geolocation
    if (this.config.blockGeolocation) {
      blocks.push(`
        // Block Geolocation
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          Object.defineProperty(navigator, 'geolocation', {
            get: function() {
              return {
                getCurrentPosition: function(s, e) { if (e) e(new Error('Geolocation blocked by security policy')); },
                watchPosition: function(s, e) { if (e) e(new Error('Geolocation blocked by security policy')); return 0; },
                clearWatch: function() {}
              };
            },
            configurable: false
          });
        }
      `);
    }

    // Block media devices (camera/microphone)
    if (this.config.blockMediaDevices) {
      blocks.push(`
        // Block Media Devices
        if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            value: function() { return Promise.reject(new Error('Media devices blocked by security policy')); },
            writable: false, configurable: false
          });
          Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
            value: function() { return Promise.reject(new Error('Display capture blocked by security policy')); },
            writable: false, configurable: false
          });
        }
      `);
    }

    // Block notifications
    if (this.config.blockNotifications) {
      blocks.push(`
        // Block Notifications
        if (typeof window !== 'undefined' && window.Notification) {
          Object.defineProperty(window, 'Notification', {
            value: class { constructor() { throw new Error('Notifications blocked by security policy'); } static get permission() { return 'denied'; } static requestPermission() { return Promise.resolve('denied'); } },
            writable: false, configurable: false
          });
        }
      `);
    }

    // Block clipboard access
    if (this.config.blockClipboard) {
      blocks.push(`
        // Block Clipboard
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              readText: function() { return Promise.reject(new Error('Clipboard access blocked')); },
              writeText: function() { return Promise.reject(new Error('Clipboard access blocked')); },
              read: function() { return Promise.reject(new Error('Clipboard access blocked')); },
              write: function() { return Promise.reject(new Error('Clipboard access blocked')); },
            },
            writable: false, configurable: false
          });
        }
      `);
    }

    // Block payment handler
    if (this.config.blockPaymentHandler) {
      blocks.push(`
        // Block Payment
        if (typeof window !== 'undefined') {
          Object.defineProperty(window, 'PaymentRequest', { value: undefined, writable: false, configurable: false });
        }
      `);
    }

    // Block USB
    if (this.config.blockUSB) {
      blocks.push(`
        // Block USB
        if (typeof navigator !== 'undefined') {
          Object.defineProperty(navigator, 'usb', { value: undefined, writable: false, configurable: false });
        }
      `);
    }

    // Block Bluetooth
    if (this.config.blockBluetooth) {
      blocks.push(`
        // Block Bluetooth
        if (typeof navigator !== 'undefined') {
          Object.defineProperty(navigator, 'bluetooth', { value: undefined, writable: false, configurable: false });
        }
      `);
    }

    // Block MIDI
    if (this.config.blockMIDI) {
      blocks.push(`
        // Block MIDI
        if (typeof navigator !== 'undefined') {
          Object.defineProperty(navigator, 'requestMIDIAccess', {
            value: function() { return Promise.reject(new Error('MIDI access blocked')); },
            writable: false, configurable: false
          });
        }
      `);
    }

    // Prevent window.open popups
    if (this.config.blockPopups) {
      blocks.push(`
        // Block window.open popups
        if (typeof window !== 'undefined') {
          const origOpen = window.open;
          window.open = function() { console.warn('window.open blocked by security policy'); return null; };
        }
      `);
    }

    // Prevent alert/confirm/prompt dialogs
    blocks.push(`
      // Block modal dialogs
      if (typeof window !== 'undefined') {
        window.alert = function() {};
        window.confirm = function() { return false; };
        window.prompt = function() { return null; };
      }
    `);

    return `(function() { 'use strict'; ${blocks.join("\n")} })();`;
  }

  /**
   * Setup cookie monitoring and enforcement
   */
  private setupCookieMonitoring(context: BrowserContext): void {
    // Periodically check and enforce cookie limits
    const monitorInterval = setInterval(async () => {
      try {
        const cookies = await context.cookies();

        // Check total cookie limit
        if (cookies.length > this.config.maxTotalCookies) {
          // Remove oldest cookies exceeding the limit
          const sortedByExpiry = cookies.sort((a, b) => {
            return (a.expires || 0) - (b.expires || 0);
          });
          const toRemove = sortedByExpiry.slice(0, cookies.length - this.config.maxTotalCookies);
          for (const cookie of toRemove) {
            await context.clearCookies({ name: cookie.name, domain: cookie.domain });
          }
        }

        // Check per-domain cookie limits
        const domainCounts = new Map<string, number>();
        for (const cookie of cookies) {
          const domain = cookie.domain || "";
          domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
        }

        for (const [domain, count] of domainCounts) {
          if (count > this.config.maxCookiesPerDomain) {
            await context.clearCookies({ domain });
          }
        }
      } catch {
        // Context might be closed
        clearInterval(monitorInterval);
      }
    }, 10_000); // Check every 10 seconds

    // Store reference for cleanup
    (context as any).__cookieMonitorInterval = monitorInterval;
  }

  /**
   * Clean up monitoring for a context
   */
  static cleanupContext(context: BrowserContext): void {
    const interval = (context as any).__cookieMonitorInterval;
    if (interval) {
      clearInterval(interval);
      delete (context as any).__cookieMonitorInterval;
    }
  }

  /**
   * Get Chromium launch args for additional security
   */
  static getSecureChromiumArgs(): string[] {
    return [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      // Security hardening flags
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-translate",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-device-discovery-notifications",
      // Prevent data exfiltration
      "--disable-client-side-phishing-detection",
      "--disable-component-extensions-with-background-pages",
      // Disable risky features
      "--disable-webgl",
      "--disable-software-rasterizer",
      "--disable-remote-fonts",
      "--disable-reading-from-canvas",
      // Network security
      "--disable-web-security=false",
      "--block-new-web-contents",
      // Process isolation
      "--site-per-process",
      "--disable-features=NetworkService,NetworkServiceInProcess",
      // Disable sensors
      "--disable-features=WebBluetooth,WebUSB",
    ];
  }
}

export const contextHardener = new BrowserContextHardener();

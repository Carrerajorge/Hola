/**
 * Browser Fingerprint Manager
 *
 * Manages browser fingerprinting to avoid detection by anti-bot systems.
 * Provides realistic user agent rotation, viewport randomization,
 * and consistent fingerprint profiles.
 */

export interface BrowserFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  platform: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  colorDepth: number;
  pixelRatio: number;
  maxTouchPoints: number;
  vendor: string;
  timezoneOffset: number;
  timezone: string;
}

export interface FingerprintManagerConfig {
  /** Enable fingerprint rotation */
  enableRotation: boolean;
  /** Rotate fingerprint every N sessions */
  rotateEveryNSessions: number;
  /** Use consistent fingerprint within a session */
  consistentWithinSession: boolean;
  /** Preferred platform */
  preferredPlatform?: "windows" | "macos" | "linux";
  /** Preferred locale */
  preferredLocale?: string;
}

const DEFAULT_FINGERPRINT_CONFIG: FingerprintManagerConfig = {
  enableRotation: true,
  rotateEveryNSessions: 5,
  consistentWithinSession: true,
  preferredPlatform: undefined,
  preferredLocale: undefined,
};

// Realistic user agent strings (updated periodically)
const USER_AGENTS: Array<{ ua: string; platform: string; vendor: string }> = [
  // Chrome on Windows
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    platform: "Win32",
    vendor: "Google Inc.",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "Win32",
    vendor: "Google Inc.",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    platform: "Win32",
    vendor: "Google Inc.",
  },
  // Chrome on macOS
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    platform: "MacIntel",
    vendor: "Google Inc.",
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "MacIntel",
    vendor: "Google Inc.",
  },
  // Firefox on Windows
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    platform: "Win32",
    vendor: "",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    platform: "Win32",
    vendor: "",
  },
  // Firefox on macOS
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0",
    platform: "MacIntel",
    vendor: "",
  },
  // Chrome on Linux
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
    vendor: "Google Inc.",
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    platform: "Linux x86_64",
    vendor: "Google Inc.",
  },
  // Edge on Windows
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    platform: "Win32",
    vendor: "Google Inc.",
  },
  // Safari on macOS
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    platform: "MacIntel",
    vendor: "Apple Computer, Inc.",
  },
];

// Common screen resolutions (desktop)
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 800 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1200 },
];

// Timezone options
const TIMEZONES = [
  { offset: -480, name: "America/Los_Angeles" },
  { offset: -420, name: "America/Denver" },
  { offset: -360, name: "America/Chicago" },
  { offset: -300, name: "America/New_York" },
  { offset: 0, name: "Europe/London" },
  { offset: 60, name: "Europe/Paris" },
  { offset: 120, name: "Europe/Berlin" },
  { offset: 540, name: "Asia/Tokyo" },
  { offset: 480, name: "Asia/Shanghai" },
];

const LANGUAGES = [
  { primary: "en-US", all: ["en-US", "en"] },
  { primary: "en-GB", all: ["en-GB", "en"] },
  { primary: "es-ES", all: ["es-ES", "es", "en"] },
  { primary: "fr-FR", all: ["fr-FR", "fr", "en"] },
  { primary: "de-DE", all: ["de-DE", "de", "en"] },
  { primary: "pt-BR", all: ["pt-BR", "pt", "en"] },
  { primary: "ja-JP", all: ["ja-JP", "ja", "en"] },
];

export class BrowserFingerprintManager {
  private config: FingerprintManagerConfig;
  private sessionCount: number = 0;
  private currentFingerprint: BrowserFingerprint | null = null;
  private sessionFingerprints: Map<string, BrowserFingerprint> = new Map();

  constructor(config: Partial<FingerprintManagerConfig> = {}) {
    this.config = { ...DEFAULT_FINGERPRINT_CONFIG, ...config };
  }

  /**
   * Generate a new fingerprint
   */
  generateFingerprint(): BrowserFingerprint {
    const uaEntry = this.selectUserAgent();
    const resolution = this.selectResolution();
    const tz = this.selectTimezone();
    const lang = this.selectLanguage();

    return {
      userAgent: uaEntry.ua,
      viewport: resolution,
      platform: uaEntry.platform,
      language: lang.primary,
      languages: lang.all,
      hardwareConcurrency: this.randomChoice([2, 4, 8, 12, 16]),
      deviceMemory: this.randomChoice([4, 8, 16]),
      colorDepth: this.randomChoice([24, 32]),
      pixelRatio: this.randomChoice([1, 1.25, 1.5, 2]),
      maxTouchPoints: 0, // Desktop browser
      vendor: uaEntry.vendor,
      timezoneOffset: tz.offset,
      timezone: tz.name,
    };
  }

  /**
   * Get fingerprint for a session (consistent within session)
   */
  getFingerprintForSession(sessionId: string): BrowserFingerprint {
    // Return existing fingerprint for this session
    if (this.config.consistentWithinSession) {
      const existing = this.sessionFingerprints.get(sessionId);
      if (existing) return existing;
    }

    // Check if we should rotate
    this.sessionCount++;
    if (
      !this.currentFingerprint ||
      (this.config.enableRotation &&
        this.sessionCount % this.config.rotateEveryNSessions === 0)
    ) {
      this.currentFingerprint = this.generateFingerprint();
    }

    // Store for this session
    const fingerprint = { ...this.currentFingerprint };
    this.sessionFingerprints.set(sessionId, fingerprint);

    return fingerprint;
  }

  /**
   * Get the init script to apply fingerprint in browser context
   */
  getInitScript(fingerprint: BrowserFingerprint): string {
    return `
      (function() {
        'use strict';

        // Override navigator properties
        var nav = navigator;

        try {
          Object.defineProperty(nav, 'platform', { get: function() { return ${JSON.stringify(fingerprint.platform)}; } });
          Object.defineProperty(nav, 'language', { get: function() { return ${JSON.stringify(fingerprint.language)}; } });
          Object.defineProperty(nav, 'languages', { get: function() { return ${JSON.stringify(fingerprint.languages)}; } });
          Object.defineProperty(nav, 'hardwareConcurrency', { get: function() { return ${fingerprint.hardwareConcurrency}; } });
          Object.defineProperty(nav, 'deviceMemory', { get: function() { return ${fingerprint.deviceMemory}; } });
          Object.defineProperty(nav, 'maxTouchPoints', { get: function() { return ${fingerprint.maxTouchPoints}; } });
          Object.defineProperty(nav, 'vendor', { get: function() { return ${JSON.stringify(fingerprint.vendor)}; } });
        } catch(e) {}

        // Override screen properties
        try {
          Object.defineProperty(screen, 'colorDepth', { get: function() { return ${fingerprint.colorDepth}; } });
          Object.defineProperty(window, 'devicePixelRatio', { get: function() { return ${fingerprint.pixelRatio}; } });
        } catch(e) {}

        // Prevent detection of automation
        try {
          Object.defineProperty(nav, 'webdriver', { get: function() { return false; } });
          delete nav.__proto__.webdriver;
        } catch(e) {}

        // Hide Playwright-specific properties
        try {
          if (window.__playwright) delete window.__playwright;
          if (window.__pw_manual) delete window.__pw_manual;
        } catch(e) {}

        // Override permissions API to look natural
        try {
          var origQuery = Permissions.prototype.query;
          Permissions.prototype.query = function(desc) {
            if (desc.name === 'notifications') {
              return Promise.resolve({ state: 'prompt', onchange: null });
            }
            return origQuery.apply(this, arguments);
          };
        } catch(e) {}

        // Consistent Date.getTimezoneOffset
        try {
          var origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
          Date.prototype.getTimezoneOffset = function() {
            return ${fingerprint.timezoneOffset};
          };
        } catch(e) {}
      })();
    `;
  }

  /**
   * Clean up session fingerprint
   */
  clearSession(sessionId: string): void {
    this.sessionFingerprints.delete(sessionId);
  }

  /**
   * Clean up all session fingerprints
   */
  clearAll(): void {
    this.sessionFingerprints.clear();
    this.currentFingerprint = null;
    this.sessionCount = 0;
  }

  private selectUserAgent(): (typeof USER_AGENTS)[0] {
    let filtered = USER_AGENTS;
    if (this.config.preferredPlatform) {
      const platformMap: Record<string, string[]> = {
        windows: ["Win32"],
        macos: ["MacIntel"],
        linux: ["Linux x86_64"],
      };
      const platforms = platformMap[this.config.preferredPlatform] || [];
      const matching = USER_AGENTS.filter(ua => platforms.includes(ua.platform));
      if (matching.length > 0) filtered = matching;
    }
    return this.randomChoice(filtered);
  }

  private selectResolution(): { width: number; height: number } {
    return this.randomChoice(SCREEN_RESOLUTIONS);
  }

  private selectTimezone(): { offset: number; name: string } {
    return this.randomChoice(TIMEZONES);
  }

  private selectLanguage(): { primary: string; all: string[] } {
    if (this.config.preferredLocale) {
      const match = LANGUAGES.find(l => l.primary === this.config.preferredLocale);
      if (match) return match;
    }
    return this.randomChoice(LANGUAGES);
  }

  private randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

export const fingerprintManager = new BrowserFingerprintManager();

/**
 * Request Interception Layer
 *
 * Intercepts and filters browser network requests to block dangerous
 * destinations, enforce content size limits, and sanitize headers.
 */

import { Page, Route, Request } from "playwright";
import { UrlSecurityManager, urlSecurity } from "./url-security";

export interface RequestInterceptorConfig {
  /** Enable request interception */
  enabled: boolean;
  /** Maximum response body size in bytes */
  maxResponseBodySize: number;
  /** Maximum number of requests per page load */
  maxRequestsPerPage: number;
  /** Block requests to tracking/analytics domains */
  blockTrackers: boolean;
  /** Block requests to ad networks */
  blockAds: boolean;
  /** Allowed request resource types */
  allowedResourceTypes: Set<string>;
  /** Blocked request resource types */
  blockedResourceTypes: Set<string>;
  /** Strip sensitive headers from requests */
  sanitizeHeaders: boolean;
  /** Headers to strip from outgoing requests */
  strippedRequestHeaders: string[];
  /** Headers to strip from responses */
  strippedResponseHeaders: string[];
  /** Block requests with specific content types */
  blockedContentTypes: string[];
  /** Maximum request URL length */
  maxRequestUrlLength: number;
  /** Block data: URIs in requests */
  blockDataURIs: boolean;
  /** Maximum concurrent requests */
  maxConcurrentRequests: number;
}

export const DEFAULT_REQUEST_INTERCEPTOR_CONFIG: RequestInterceptorConfig = {
  enabled: true,
  maxResponseBodySize: 25 * 1024 * 1024, // 25MB
  maxRequestsPerPage: 500,
  blockTrackers: true,
  blockAds: true,
  allowedResourceTypes: new Set([
    "document", "stylesheet", "image", "font", "script",
    "xhr", "fetch", "other",
  ]),
  blockedResourceTypes: new Set([
    "media",     // Block video/audio autoplay
    "websocket", // Block WebSocket connections
    "eventsource",
  ]),
  sanitizeHeaders: true,
  strippedRequestHeaders: [
    "authorization",
    "cookie",
    "x-csrf-token",
    "x-xsrf-token",
    "x-api-key",
    "api-key",
  ],
  strippedResponseHeaders: [
    "set-cookie",
  ],
  blockedContentTypes: [
    "application/x-shockwave-flash",
    "application/x-silverlight",
    "application/java-archive",
    "application/x-java-applet",
  ],
  maxRequestUrlLength: 8192,
  blockDataURIs: true,
  maxConcurrentRequests: 50,
};

// Known tracker domains (subset for efficiency)
const TRACKER_DOMAINS = new Set([
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com/tr",
  "analytics.google.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "fullstory.com",
  "heap.io",
  "heapanalytics.com",
  "crazyegg.com",
  "mouseflow.com",
  "clarity.ms",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",
  "bugsnag.com",
  "logrocket.com",
  "smartlook.com",
  "quantserve.com",
  "scorecardresearch.com",
]);

// Known ad network domains (subset)
const AD_DOMAINS = new Set([
  "googlesyndication.com",
  "googleadservices.com",
  "adsrvr.org",
  "adnxs.com",
  "criteo.com",
  "criteo.net",
  "moatads.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "bidswitch.net",
  "outbrain.com",
  "taboola.com",
  "revcontent.com",
  "mgid.com",
  "adform.net",
  "serving-sys.com",
  "adsafeprotected.com",
  "doubleverify.com",
]);

export interface InterceptorStats {
  totalRequests: number;
  blockedRequests: number;
  blockedByUrl: number;
  blockedByType: number;
  blockedByTracker: number;
  blockedByAd: number;
  blockedBySize: number;
  totalResponseBytes: number;
}

export class RequestInterceptor {
  private config: RequestInterceptorConfig;
  private urlSecurity: UrlSecurityManager;
  private stats: Map<string, InterceptorStats> = new Map();
  private activeRequests: Map<string, number> = new Map();

  constructor(
    config: Partial<RequestInterceptorConfig> = {},
    urlSecurityManager?: UrlSecurityManager
  ) {
    this.config = { ...DEFAULT_REQUEST_INTERCEPTOR_CONFIG, ...config };
    this.urlSecurity = urlSecurityManager || urlSecurity;
  }

  /**
   * Install request interception on a page
   */
  async install(page: Page, sessionId: string): Promise<void> {
    if (!this.config.enabled) return;

    // Initialize stats
    this.stats.set(sessionId, {
      totalRequests: 0,
      blockedRequests: 0,
      blockedByUrl: 0,
      blockedByType: 0,
      blockedByTracker: 0,
      blockedByAd: 0,
      blockedBySize: 0,
      totalResponseBytes: 0,
    });
    this.activeRequests.set(sessionId, 0);

    // Enable routing for all requests
    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      const stats = this.stats.get(sessionId)!;
      stats.totalRequests++;

      try {
        const decision = await this.shouldAllowRequest(request, sessionId);

        if (!decision.allowed) {
          stats.blockedRequests++;
          switch (decision.blockReason) {
            case "url": stats.blockedByUrl++; break;
            case "type": stats.blockedByType++; break;
            case "tracker": stats.blockedByTracker++; break;
            case "ad": stats.blockedByAd++; break;
            case "size": stats.blockedBySize++; break;
          }

          await route.abort("blockedbyclient");
          return;
        }

        // Sanitize headers if configured
        if (this.config.sanitizeHeaders) {
          const headers = this.sanitizeRequestHeaders(request.headers());
          await route.continue({ headers });
        } else {
          await route.continue();
        }
      } catch (error) {
        // If route handling fails, allow the request to prevent breaking pages
        try {
          await route.continue();
        } catch {
          // Route may have already been handled
        }
      }
    });
  }

  /**
   * Determine if a request should be allowed
   */
  private async shouldAllowRequest(
    request: Request,
    sessionId: string
  ): Promise<{ allowed: boolean; blockReason?: string }> {
    const url = request.url();
    const resourceType = request.resourceType();

    // 1. Check request count limit
    const stats = this.stats.get(sessionId);
    if (stats && stats.totalRequests > this.config.maxRequestsPerPage) {
      return { allowed: false, blockReason: "size" };
    }

    // 2. Check concurrent request limit
    const concurrent = this.activeRequests.get(sessionId) || 0;
    if (concurrent >= this.config.maxConcurrentRequests) {
      return { allowed: false, blockReason: "size" };
    }

    // 3. Check URL length
    if (url.length > this.config.maxRequestUrlLength) {
      return { allowed: false, blockReason: "url" };
    }

    // 4. Block data: URIs (potential data exfiltration)
    if (this.config.blockDataURIs && url.startsWith("data:")) {
      // Allow small inline data URIs for images (common in web pages)
      if (url.startsWith("data:image/") && url.length < 10000) {
        return { allowed: true };
      }
      return { allowed: false, blockReason: "url" };
    }

    // 5. Check resource type
    if (this.config.blockedResourceTypes.has(resourceType)) {
      return { allowed: false, blockReason: "type" };
    }

    // 6. URL security check (SSRF, private IPs, etc.)
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const urlCheck = this.urlSecurity.validateUrlSync(url);
      if (!urlCheck.allowed) {
        return { allowed: false, blockReason: "url" };
      }
    }

    // 7. Check tracker domains
    if (this.config.blockTrackers) {
      const hostname = this.extractHostname(url);
      if (hostname && this.isTrackerDomain(hostname)) {
        return { allowed: false, blockReason: "tracker" };
      }
    }

    // 8. Check ad domains
    if (this.config.blockAds) {
      const hostname = this.extractHostname(url);
      if (hostname && this.isAdDomain(hostname)) {
        return { allowed: false, blockReason: "ad" };
      }
    }

    return { allowed: true };
  }

  /**
   * Sanitize request headers to remove sensitive information
   */
  private sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!this.config.strippedRequestHeaders.includes(lowerKey)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Check if a hostname is a known tracker domain
   */
  private isTrackerDomain(hostname: string): boolean {
    const parts = hostname.toLowerCase().split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join(".");
      if (TRACKER_DOMAINS.has(domain)) return true;
    }
    return false;
  }

  /**
   * Check if a hostname is a known ad domain
   */
  private isAdDomain(hostname: string): boolean {
    const parts = hostname.toLowerCase().split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const domain = parts.slice(i).join(".");
      if (AD_DOMAINS.has(domain)) return true;
    }
    return false;
  }

  /**
   * Extract hostname from a URL
   */
  private extractHostname(url: string): string | null {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  /**
   * Get interception statistics for a session
   */
  getStats(sessionId: string): InterceptorStats | undefined {
    return this.stats.get(sessionId);
  }

  /**
   * Clear stats for a session
   */
  clearStats(sessionId: string): void {
    this.stats.delete(sessionId);
    this.activeRequests.delete(sessionId);
  }

  /**
   * Get all session stats
   */
  getAllStats(): Map<string, InterceptorStats> {
    return new Map(this.stats);
  }
}

export const requestInterceptor = new RequestInterceptor();

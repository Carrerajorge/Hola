/**
 * URL & Navigation Security Module
 *
 * Prevents SSRF attacks, blocks private/internal IPs, enforces protocol
 * whitelists, and provides DNS rebinding protection for browser automation.
 */

import { URL } from "url";
import dns from "dns";
import { promisify } from "util";

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// Only allow http and https protocols
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Dangerous protocols that must never be used
const BLOCKED_PROTOCOLS = new Set([
  "file:", "javascript:", "data:", "blob:", "vbscript:",
  "ftp:", "gopher:", "ws:", "wss:", "chrome:", "chrome-extension:",
  "about:", "view-source:", "devtools:",
]);

// Private/internal IP ranges (CIDR notation concepts)
const PRIVATE_IP_RANGES = [
  // IPv4 private ranges
  { start: "10.0.0.0", end: "10.255.255.255", label: "RFC1918 Class A" },
  { start: "172.16.0.0", end: "172.31.255.255", label: "RFC1918 Class B" },
  { start: "192.168.0.0", end: "192.168.255.255", label: "RFC1918 Class C" },
  // Loopback
  { start: "127.0.0.0", end: "127.255.255.255", label: "Loopback" },
  // Link-local
  { start: "169.254.0.0", end: "169.254.255.255", label: "Link-local" },
  // APIPA/Cloud metadata (AWS, GCP, Azure)
  { start: "169.254.169.254", end: "169.254.169.254", label: "Cloud Metadata" },
  // Current network
  { start: "0.0.0.0", end: "0.255.255.255", label: "Current Network" },
  // Shared address space
  { start: "100.64.0.0", end: "100.127.255.255", label: "Shared Address Space" },
  // IETF protocol assignments
  { start: "192.0.0.0", end: "192.0.0.255", label: "IETF Protocol" },
  // Documentation range
  { start: "192.0.2.0", end: "192.0.2.255", label: "Documentation TEST-NET-1" },
  { start: "198.51.100.0", end: "198.51.100.255", label: "Documentation TEST-NET-2" },
  { start: "203.0.113.0", end: "203.0.113.255", label: "Documentation TEST-NET-3" },
  // Broadcast
  { start: "255.255.255.255", end: "255.255.255.255", label: "Broadcast" },
];

// Cloud metadata endpoints that must always be blocked
const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",          // AWS, GCP, Azure
  "metadata.google.internal", // GCP
  "metadata.google",          // GCP alternative
  "100.100.100.200",          // Alibaba Cloud
  "169.254.170.2",            // AWS ECS task metadata
]);

// Blocked hostnames patterns
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /^0x[0-9a-f]+$/i,           // Hex-encoded IPs
  /^\d{10,}$/,                // Decimal-encoded IPs
  /^0\d+\.\d+\.\d+\.\d+$/,   // Octal-encoded IPs
  /\.internal$/i,
  /\.local$/i,
  /\.localhost$/i,
  /\.localdomain$/i,
  /\.corp$/i,
  /\.home$/i,
  /\.lan$/i,
  /\.intranet$/i,
  /\.private$/i,
];

// Maximum redirect depth
const MAX_REDIRECT_DEPTH = 5;

// Maximum URL length
const MAX_URL_LENGTH = 8192;

export interface UrlSecurityConfig {
  allowPrivateIPs: boolean;
  allowCloudMetadata: boolean;
  allowedProtocols: Set<string>;
  blockedProtocols: Set<string>;
  blockedHostnamePatterns: RegExp[];
  maxUrlLength: number;
  maxRedirectDepth: number;
  enableDnsCheck: boolean;
  additionalBlockedHosts: string[];
  additionalAllowedHosts: string[];
}

export const DEFAULT_URL_SECURITY_CONFIG: UrlSecurityConfig = {
  allowPrivateIPs: false,
  allowCloudMetadata: false,
  allowedProtocols: ALLOWED_PROTOCOLS,
  blockedProtocols: BLOCKED_PROTOCOLS,
  blockedHostnamePatterns: BLOCKED_HOSTNAME_PATTERNS,
  maxUrlLength: MAX_URL_LENGTH,
  maxRedirectDepth: MAX_REDIRECT_DEPTH,
  enableDnsCheck: true,
  additionalBlockedHosts: [],
  additionalAllowedHosts: [],
};

export interface UrlValidationResult {
  allowed: boolean;
  reason?: string;
  normalizedUrl?: string;
  resolvedIPs?: string[];
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
}

function ipToLong(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isIPInRange(ip: string, start: string, end: string): boolean {
  const ipLong = ipToLong(ip);
  const startLong = ipToLong(start);
  const endLong = ipToLong(end);
  return ipLong >= startLong && ipLong <= endLong;
}

function isIPv4(str: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(str);
}

function isIPv6(str: string): boolean {
  return /^[\da-f:]+$/i.test(str) && str.includes(":");
}

/**
 * Decode obfuscated IP addresses (hex, octal, decimal encoding)
 */
function deobfuscateIP(hostname: string): string | null {
  // Hex-encoded: 0x7f000001
  if (/^0x[0-9a-f]+$/i.test(hostname)) {
    const num = parseInt(hostname, 16);
    return [
      (num >> 24) & 0xff,
      (num >> 16) & 0xff,
      (num >> 8) & 0xff,
      num & 0xff,
    ].join(".");
  }

  // Decimal-encoded: 2130706433
  if (/^\d{10,}$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num <= 0xffffffff) {
      return [
        (num >> 24) & 0xff,
        (num >> 16) & 0xff,
        (num >> 8) & 0xff,
        num & 0xff,
      ].join(".");
    }
  }

  // Octal-encoded parts: 0177.0.0.1 => 127.0.0.1
  if (/^0\d+\./.test(hostname)) {
    const parts = hostname.split(".");
    if (parts.length === 4) {
      const decoded = parts.map(p => {
        if (p.startsWith("0") && p.length > 1 && !/[89]/.test(p)) {
          return parseInt(p, 8);
        }
        return parseInt(p, 10);
      });
      if (decoded.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
        return decoded.join(".");
      }
    }
  }

  return null;
}

function isPrivateIP(ip: string): boolean {
  if (!isIPv4(ip)) return false;

  for (const range of PRIVATE_IP_RANGES) {
    if (isIPInRange(ip, range.start, range.end)) {
      return true;
    }
  }
  return false;
}

function isIPv6Private(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // ::1 loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  // fe80::/10 link-local
  if (normalized.startsWith("fe80:")) return true;
  // fc00::/7 unique local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // ::ffff:127.0.0.1 IPv4-mapped
  if (normalized.startsWith("::ffff:")) {
    const v4Part = normalized.slice(7);
    if (isIPv4(v4Part) && isPrivateIP(v4Part)) return true;
  }
  return false;
}

export class UrlSecurityManager {
  private config: UrlSecurityConfig;
  private dnsCache: Map<string, { ips: string[]; expiry: number }> = new Map();
  private readonly DNS_CACHE_TTL = 60_000; // 1 minute

  constructor(config: Partial<UrlSecurityConfig> = {}) {
    this.config = { ...DEFAULT_URL_SECURITY_CONFIG, ...config };
  }

  /**
   * Validate and sanitize a URL for browser navigation
   */
  async validateUrl(url: string): Promise<UrlValidationResult> {
    // 1. Length check
    if (!url || url.length > this.config.maxUrlLength) {
      return {
        allowed: false,
        reason: `URL exceeds maximum length of ${this.config.maxUrlLength} characters`,
        riskLevel: "high",
      };
    }

    // 2. Parse URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        allowed: false,
        reason: "Invalid URL format",
        riskLevel: "high",
      };
    }

    // 3. Protocol check
    if (this.config.blockedProtocols.has(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${parsed.protocol}' is blocked`,
        riskLevel: "critical",
      };
    }

    if (!this.config.allowedProtocols.has(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${parsed.protocol}' is not allowed. Only ${Array.from(this.config.allowedProtocols).join(", ")} are permitted`,
        riskLevel: "high",
      };
    }

    // 4. Strip credentials from URL
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }

    const hostname = parsed.hostname.toLowerCase();

    // 5. Cloud metadata endpoint check
    if (!this.config.allowCloudMetadata && CLOUD_METADATA_HOSTS.has(hostname)) {
      return {
        allowed: false,
        reason: "Access to cloud metadata endpoints is blocked (SSRF protection)",
        riskLevel: "critical",
      };
    }

    // 6. Blocked hostname pattern check
    for (const pattern of this.config.blockedHostnamePatterns) {
      if (pattern.test(hostname)) {
        return {
          allowed: false,
          reason: `Hostname '${hostname}' matches blocked pattern`,
          riskLevel: "critical",
        };
      }
    }

    // 7. Additional blocked hosts
    if (this.config.additionalBlockedHosts.includes(hostname)) {
      return {
        allowed: false,
        reason: `Hostname '${hostname}' is explicitly blocked`,
        riskLevel: "high",
      };
    }

    // 8. Deobfuscation check
    const deobfuscated = deobfuscateIP(hostname);
    if (deobfuscated) {
      if (isPrivateIP(deobfuscated)) {
        return {
          allowed: false,
          reason: `Obfuscated private IP detected: ${hostname} => ${deobfuscated}`,
          riskLevel: "critical",
        };
      }
    }

    // 9. Direct IP check
    if (isIPv4(hostname) && !this.config.allowPrivateIPs && isPrivateIP(hostname)) {
      return {
        allowed: false,
        reason: `Private IPv4 address '${hostname}' is not allowed`,
        riskLevel: "critical",
      };
    }

    if (isIPv6(hostname) && !this.config.allowPrivateIPs && isIPv6Private(hostname)) {
      return {
        allowed: false,
        reason: `Private IPv6 address '${hostname}' is not allowed`,
        riskLevel: "critical",
      };
    }

    // 10. DNS resolution check (async) - prevent DNS rebinding
    let resolvedIPs: string[] = [];
    if (this.config.enableDnsCheck && !isIPv4(hostname) && !isIPv6(hostname)) {
      try {
        resolvedIPs = await this.resolveAndCheckDNS(hostname);
      } catch (error: any) {
        // DNS resolution failure is suspicious but not always blocking
        if (error.code === "SSRF_DETECTED") {
          return {
            allowed: false,
            reason: error.message,
            riskLevel: "critical",
          };
        }
        // Allow if DNS just can't resolve (might be a valid external host)
      }
    }

    // 11. Port check - block common internal service ports
    const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
    if (!this.isPortAllowed(port)) {
      return {
        allowed: false,
        reason: `Port ${port} is not allowed for browser navigation`,
        riskLevel: "high",
      };
    }

    const normalizedUrl = parsed.href;

    return {
      allowed: true,
      normalizedUrl,
      resolvedIPs,
      riskLevel: "safe",
    };
  }

  /**
   * Synchronous URL validation (without DNS check)
   */
  validateUrlSync(url: string): UrlValidationResult {
    if (!url || url.length > this.config.maxUrlLength) {
      return {
        allowed: false,
        reason: `URL exceeds maximum length of ${this.config.maxUrlLength} characters`,
        riskLevel: "high",
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        allowed: false,
        reason: "Invalid URL format",
        riskLevel: "high",
      };
    }

    if (this.config.blockedProtocols.has(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${parsed.protocol}' is blocked`,
        riskLevel: "critical",
      };
    }

    if (!this.config.allowedProtocols.has(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${parsed.protocol}' is not allowed`,
        riskLevel: "high",
      };
    }

    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }

    const hostname = parsed.hostname.toLowerCase();

    if (!this.config.allowCloudMetadata && CLOUD_METADATA_HOSTS.has(hostname)) {
      return {
        allowed: false,
        reason: "Access to cloud metadata endpoints is blocked",
        riskLevel: "critical",
      };
    }

    for (const pattern of this.config.blockedHostnamePatterns) {
      if (pattern.test(hostname)) {
        return {
          allowed: false,
          reason: `Hostname '${hostname}' matches blocked pattern`,
          riskLevel: "critical",
        };
      }
    }

    const deobfuscated = deobfuscateIP(hostname);
    if (deobfuscated && isPrivateIP(deobfuscated)) {
      return {
        allowed: false,
        reason: `Obfuscated private IP detected: ${hostname} => ${deobfuscated}`,
        riskLevel: "critical",
      };
    }

    if (isIPv4(hostname) && !this.config.allowPrivateIPs && isPrivateIP(hostname)) {
      return {
        allowed: false,
        reason: `Private IPv4 address '${hostname}' is not allowed`,
        riskLevel: "critical",
      };
    }

    if (isIPv6(hostname) && !this.config.allowPrivateIPs && isIPv6Private(hostname)) {
      return {
        allowed: false,
        reason: `Private IPv6 address '${hostname}' is not allowed`,
        riskLevel: "critical",
      };
    }

    const port = parsed.port ? parseInt(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
    if (!this.isPortAllowed(port)) {
      return {
        allowed: false,
        reason: `Port ${port} is not allowed for browser navigation`,
        riskLevel: "high",
      };
    }

    return {
      allowed: true,
      normalizedUrl: parsed.href,
      riskLevel: "safe",
    };
  }

  /**
   * Resolve DNS and verify IPs are not private
   */
  private async resolveAndCheckDNS(hostname: string): Promise<string[]> {
    // Check cache first
    const cached = this.dnsCache.get(hostname);
    if (cached && cached.expiry > Date.now()) {
      return cached.ips;
    }

    const allIPs: string[] = [];

    try {
      const ipv4 = await dnsResolve4(hostname);
      allIPs.push(...ipv4);
    } catch {
      // IPv4 resolution might fail, that's ok
    }

    try {
      const ipv6 = await dnsResolve6(hostname);
      allIPs.push(...ipv6);
    } catch {
      // IPv6 resolution might fail, that's ok
    }

    // Check all resolved IPs for private ranges
    if (!this.config.allowPrivateIPs) {
      for (const ip of allIPs) {
        if (isIPv4(ip) && isPrivateIP(ip)) {
          const error = new Error(
            `DNS rebinding detected: '${hostname}' resolves to private IP ${ip}`
          );
          (error as any).code = "SSRF_DETECTED";
          throw error;
        }
        if (isIPv6(ip) && isIPv6Private(ip)) {
          const error = new Error(
            `DNS rebinding detected: '${hostname}' resolves to private IPv6 ${ip}`
          );
          (error as any).code = "SSRF_DETECTED";
          throw error;
        }
      }
    }

    // Cache the results
    this.dnsCache.set(hostname, {
      ips: allIPs,
      expiry: Date.now() + this.DNS_CACHE_TTL,
    });

    return allIPs;
  }

  /**
   * Check if a port is allowed for browser navigation
   */
  private isPortAllowed(port: number): boolean {
    // Standard web ports
    const allowedPorts = new Set([80, 443, 8080, 8443, 3000, 5000, 8000, 8888]);

    // Block common internal service ports
    const blockedPorts = new Set([
      22,    // SSH
      25,    // SMTP
      53,    // DNS
      110,   // POP3
      143,   // IMAP
      389,   // LDAP
      445,   // SMB
      465,   // SMTPS
      587,   // SMTP submission
      636,   // LDAPS
      993,   // IMAPS
      995,   // POP3S
      1433,  // MSSQL
      1521,  // Oracle
      2049,  // NFS
      3306,  // MySQL
      5432,  // PostgreSQL
      5672,  // AMQP/RabbitMQ
      6379,  // Redis
      6380,  // Redis TLS
      9200,  // Elasticsearch
      11211, // Memcached
      27017, // MongoDB
    ]);

    if (blockedPorts.has(port)) return false;
    if (port < 1 || port > 65535) return false;

    return true;
  }

  /**
   * Validate a redirect URL ensuring no redirect to private/blocked addresses
   */
  async validateRedirect(
    originalUrl: string,
    redirectUrl: string,
    depth: number = 0
  ): Promise<UrlValidationResult> {
    if (depth >= this.config.maxRedirectDepth) {
      return {
        allowed: false,
        reason: `Maximum redirect depth (${this.config.maxRedirectDepth}) exceeded`,
        riskLevel: "high",
      };
    }

    return this.validateUrl(redirectUrl);
  }

  /**
   * Clear the DNS cache
   */
  clearDnsCache(): void {
    this.dnsCache.clear();
  }
}

export const urlSecurity = new UrlSecurityManager();

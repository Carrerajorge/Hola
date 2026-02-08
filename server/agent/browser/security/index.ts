/**
 * Browser Security Module - Central Export
 *
 * Comprehensive browser automation hardening for ILIAGPT.
 * Provides protection against SSRF, XSS, data exfiltration,
 * session abuse, and other browser-based attack vectors.
 */

export { UrlSecurityManager, urlSecurity } from "./url-security";
export type { UrlSecurityConfig, UrlValidationResult } from "./url-security";

export { BrowserContextHardener, contextHardener } from "./context-hardening";
export type { ContextHardeningConfig, ContextHardeningResult } from "./context-hardening";

export { SessionSecurityManager, sessionSecurity } from "./session-security";
export type { SessionSecurityConfig, SessionMetrics, SessionSecurityEvent } from "./session-security";

export { JsSandboxManager, jsSandbox } from "./js-sandbox";
export type { JsSandboxConfig, ScriptValidationResult } from "./js-sandbox";

export { RequestInterceptor, requestInterceptor } from "./request-interceptor";
export type { RequestInterceptorConfig, InterceptorStats } from "./request-interceptor";

export { SelectorSanitizer, selectorSanitizer } from "./selector-sanitizer";
export type { SelectorSanitizerConfig, SelectorValidationResult } from "./selector-sanitizer";

export { DownloadSecurityManager, downloadSecurity } from "./download-security";
export type { DownloadSecurityConfig, DownloadValidationResult } from "./download-security";

export { BrowserSecurityAuditLogger, browserAuditLogger } from "./audit-logger";
export type { SecurityAuditEvent, SecurityEventSeverity, SecurityEventCategory } from "./audit-logger";

export { BrowserFingerprintManager, fingerprintManager } from "./fingerprint-manager";
export type { BrowserFingerprint, FingerprintManagerConfig } from "./fingerprint-manager";

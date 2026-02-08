/**
 * Browser Security Audit Logger
 *
 * Comprehensive logging of all security-relevant browser automation events.
 * Supports anomaly detection and security event reporting.
 */

export type SecurityEventSeverity = "info" | "warning" | "error" | "critical";

export type SecurityEventCategory =
  | "navigation"
  | "session"
  | "javascript"
  | "download"
  | "network"
  | "selector"
  | "authentication"
  | "policy"
  | "anomaly"
  | "resource";

export interface SecurityAuditEvent {
  id: string;
  timestamp: Date;
  category: SecurityEventCategory;
  severity: SecurityEventSeverity;
  sessionId: string;
  action: string;
  details: Record<string, any>;
  blocked: boolean;
  riskScore: number; // 0-100
  sourceIP?: string;
  userId?: string;
}

export interface AuditLoggerConfig {
  /** Maximum events to keep in memory */
  maxEventsInMemory: number;
  /** Enable console logging for critical events */
  logCriticalToConsole: boolean;
  /** Enable console logging for all blocked events */
  logBlockedToConsole: boolean;
  /** Enable anomaly detection */
  enableAnomalyDetection: boolean;
  /** Anomaly detection: max events per minute per session */
  maxEventsPerMinutePerSession: number;
  /** Anomaly detection: max blocked events before alert */
  maxBlockedEventsBeforeAlert: number;
  /** Event retention time in milliseconds */
  eventRetentionMs: number;
}

const DEFAULT_AUDIT_CONFIG: AuditLoggerConfig = {
  maxEventsInMemory: 10_000,
  logCriticalToConsole: true,
  logBlockedToConsole: true,
  enableAnomalyDetection: true,
  maxEventsPerMinutePerSession: 100,
  maxBlockedEventsBeforeAlert: 10,
  eventRetentionMs: 60 * 60 * 1000, // 1 hour
};

type AuditEventCallback = (event: SecurityAuditEvent) => void;

let eventCounter = 0;

export class BrowserSecurityAuditLogger {
  private config: AuditLoggerConfig;
  private events: SecurityAuditEvent[] = [];
  private eventCallbacks: Set<AuditEventCallback> = new Set();
  private sessionEventCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private sessionBlockedCounts: Map<string, number> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };

    // Start periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.pruneOldEvents();
    }, 60_000); // Every minute
  }

  /**
   * Log a security event
   */
  log(event: Omit<SecurityAuditEvent, "id" | "timestamp">): SecurityAuditEvent {
    const fullEvent: SecurityAuditEvent = {
      ...event,
      id: `sec-${Date.now()}-${++eventCounter}`,
      timestamp: new Date(),
    };

    // Store event
    this.events.push(fullEvent);
    if (this.events.length > this.config.maxEventsInMemory) {
      this.events.shift();
    }

    // Console logging
    if (this.config.logCriticalToConsole && fullEvent.severity === "critical") {
      console.error(
        `[SECURITY:CRITICAL] [${fullEvent.category}] ${fullEvent.action} - Session: ${fullEvent.sessionId}`,
        JSON.stringify(fullEvent.details)
      );
    } else if (this.config.logBlockedToConsole && fullEvent.blocked) {
      console.warn(
        `[SECURITY:BLOCKED] [${fullEvent.category}] ${fullEvent.action} - Session: ${fullEvent.sessionId}`,
        fullEvent.details.reason || ""
      );
    }

    // Anomaly detection
    if (this.config.enableAnomalyDetection) {
      this.checkAnomalies(fullEvent);
    }

    // Track blocked events
    if (fullEvent.blocked) {
      const blockedCount = (this.sessionBlockedCounts.get(fullEvent.sessionId) || 0) + 1;
      this.sessionBlockedCounts.set(fullEvent.sessionId, blockedCount);
    }

    // Notify callbacks
    for (const cb of this.eventCallbacks) {
      try {
        cb(fullEvent);
      } catch {
        // Ignore callback errors
      }
    }

    return fullEvent;
  }

  // --- Convenience logging methods ---

  logNavigation(
    sessionId: string,
    url: string,
    allowed: boolean,
    reason?: string
  ): SecurityAuditEvent {
    return this.log({
      category: "navigation",
      severity: allowed ? "info" : "warning",
      sessionId,
      action: allowed ? "navigation_allowed" : "navigation_blocked",
      details: { url, reason },
      blocked: !allowed,
      riskScore: allowed ? 0 : 60,
    });
  }

  logSSRFAttempt(sessionId: string, url: string, reason: string): SecurityAuditEvent {
    return this.log({
      category: "navigation",
      severity: "critical",
      sessionId,
      action: "ssrf_attempt_blocked",
      details: { url, reason },
      blocked: true,
      riskScore: 95,
    });
  }

  logJsExecution(
    sessionId: string,
    scriptPreview: string,
    allowed: boolean,
    reason?: string
  ): SecurityAuditEvent {
    return this.log({
      category: "javascript",
      severity: allowed ? "info" : "warning",
      sessionId,
      action: allowed ? "js_execution_allowed" : "js_execution_blocked",
      details: {
        scriptPreview: scriptPreview.slice(0, 200),
        scriptLength: scriptPreview.length,
        reason,
      },
      blocked: !allowed,
      riskScore: allowed ? 10 : 70,
    });
  }

  logSelectorBlocked(
    sessionId: string,
    selector: string,
    reason: string
  ): SecurityAuditEvent {
    return this.log({
      category: "selector",
      severity: "warning",
      sessionId,
      action: "selector_blocked",
      details: { selector: selector.slice(0, 200), reason },
      blocked: true,
      riskScore: 50,
    });
  }

  logDownload(
    sessionId: string,
    filename: string,
    sizeBytes: number,
    allowed: boolean,
    reason?: string
  ): SecurityAuditEvent {
    return this.log({
      category: "download",
      severity: allowed ? "info" : "warning",
      sessionId,
      action: allowed ? "download_allowed" : "download_blocked",
      details: { filename, sizeBytes, reason },
      blocked: !allowed,
      riskScore: allowed ? 5 : 65,
    });
  }

  logSessionEvent(
    sessionId: string,
    action: string,
    details: Record<string, any> = {}
  ): SecurityAuditEvent {
    return this.log({
      category: "session",
      severity: "info",
      sessionId,
      action,
      details,
      blocked: false,
      riskScore: 0,
    });
  }

  logSessionViolation(
    sessionId: string,
    action: string,
    details: Record<string, any> = {}
  ): SecurityAuditEvent {
    return this.log({
      category: "session",
      severity: "error",
      sessionId,
      action,
      details,
      blocked: true,
      riskScore: 75,
    });
  }

  logNetworkBlock(
    sessionId: string,
    url: string,
    reason: string
  ): SecurityAuditEvent {
    return this.log({
      category: "network",
      severity: "warning",
      sessionId,
      action: "network_request_blocked",
      details: { url: url.slice(0, 500), reason },
      blocked: true,
      riskScore: 40,
    });
  }

  logAnomaly(
    sessionId: string,
    anomalyType: string,
    details: Record<string, any>
  ): SecurityAuditEvent {
    return this.log({
      category: "anomaly",
      severity: "error",
      sessionId,
      action: `anomaly_detected_${anomalyType}`,
      details,
      blocked: false,
      riskScore: 80,
    });
  }

  logResourceLimit(
    sessionId: string,
    resource: string,
    current: number,
    limit: number
  ): SecurityAuditEvent {
    return this.log({
      category: "resource",
      severity: "warning",
      sessionId,
      action: "resource_limit_approached",
      details: { resource, current, limit, utilization: `${((current / limit) * 100).toFixed(1)}%` },
      blocked: false,
      riskScore: 30,
    });
  }

  // --- Anomaly Detection ---

  private checkAnomalies(event: SecurityAuditEvent): void {
    const sessionId = event.sessionId;
    const now = Date.now();
    const windowMs = 60_000; // 1 minute window

    // Rate of events per session
    const sessionRate = this.sessionEventCounts.get(sessionId);
    if (!sessionRate || now - sessionRate.windowStart > windowMs) {
      this.sessionEventCounts.set(sessionId, { count: 1, windowStart: now });
    } else {
      sessionRate.count++;
      if (sessionRate.count > this.config.maxEventsPerMinutePerSession) {
        this.logAnomaly(sessionId, "high_event_rate", {
          eventsPerMinute: sessionRate.count,
          threshold: this.config.maxEventsPerMinutePerSession,
        });
      }
    }

    // Excessive blocked events
    const blockedCount = this.sessionBlockedCounts.get(sessionId) || 0;
    if (blockedCount === this.config.maxBlockedEventsBeforeAlert) {
      this.logAnomaly(sessionId, "excessive_blocked_events", {
        blockedCount,
        threshold: this.config.maxBlockedEventsBeforeAlert,
      });
    }
  }

  // --- Query Methods ---

  /**
   * Get events by session ID
   */
  getEventsBySession(sessionId: string): SecurityAuditEvent[] {
    return this.events.filter(e => e.sessionId === sessionId);
  }

  /**
   * Get events by severity
   */
  getEventsBySeverity(severity: SecurityEventSeverity): SecurityAuditEvent[] {
    return this.events.filter(e => e.severity === severity);
  }

  /**
   * Get events by category
   */
  getEventsByCategory(category: SecurityEventCategory): SecurityAuditEvent[] {
    return this.events.filter(e => e.category === category);
  }

  /**
   * Get blocked events
   */
  getBlockedEvents(): SecurityAuditEvent[] {
    return this.events.filter(e => e.blocked);
  }

  /**
   * Get high-risk events (riskScore >= threshold)
   */
  getHighRiskEvents(threshold: number = 70): SecurityAuditEvent[] {
    return this.events.filter(e => e.riskScore >= threshold);
  }

  /**
   * Get events in a time range
   */
  getEventsInRange(start: Date, end: Date): SecurityAuditEvent[] {
    return this.events.filter(
      e => e.timestamp >= start && e.timestamp <= end
    );
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalEvents: number;
    blockedEvents: number;
    criticalEvents: number;
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    averageRiskScore: number;
    topBlockedActions: Array<{ action: string; count: number }>;
  } {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const blockedActions: Record<string, number> = {};
    let totalRisk = 0;
    let blockedCount = 0;
    let criticalCount = 0;

    for (const event of this.events) {
      byCategory[event.category] = (byCategory[event.category] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      totalRisk += event.riskScore;

      if (event.blocked) {
        blockedCount++;
        blockedActions[event.action] = (blockedActions[event.action] || 0) + 1;
      }
      if (event.severity === "critical") criticalCount++;
    }

    const topBlockedActions = Object.entries(blockedActions)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEvents: this.events.length,
      blockedEvents: blockedCount,
      criticalEvents: criticalCount,
      byCategory,
      bySeverity,
      averageRiskScore: this.events.length > 0 ? totalRisk / this.events.length : 0,
      topBlockedActions,
    };
  }

  /**
   * Add event listener
   */
  addEventListener(callback: AuditEventCallback): void {
    this.eventCallbacks.add(callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(callback: AuditEventCallback): void {
    this.eventCallbacks.delete(callback);
  }

  /**
   * Clear all events
   */
  clearEvents(): void {
    this.events = [];
    this.sessionEventCounts.clear();
    this.sessionBlockedCounts.clear();
  }

  /**
   * Clear events for a session
   */
  clearSessionEvents(sessionId: string): void {
    this.events = this.events.filter(e => e.sessionId !== sessionId);
    this.sessionEventCounts.delete(sessionId);
    this.sessionBlockedCounts.delete(sessionId);
  }

  /**
   * Prune old events based on retention policy
   */
  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.config.eventRetentionMs;
    this.events = this.events.filter(e => e.timestamp.getTime() > cutoff);
  }

  /**
   * Shutdown the logger
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.eventCallbacks.clear();
  }
}

export const browserAuditLogger = new BrowserSecurityAuditLogger();

/**
 * Session Security Module
 *
 * Enforces session TTLs, concurrent session limits, memory monitoring,
 * and secure session cleanup for browser automation.
 */

export interface SessionSecurityConfig {
  /** Maximum session lifetime in milliseconds */
  maxSessionLifetimeMs: number;
  /** Maximum concurrent browser sessions */
  maxConcurrentSessions: number;
  /** Session idle timeout in milliseconds (no actions) */
  idleTimeoutMs: number;
  /** Maximum memory per session in bytes */
  maxMemoryPerSessionBytes: number;
  /** Maximum total memory for all sessions in bytes */
  maxTotalMemoryBytes: number;
  /** Maximum actions per session */
  maxActionsPerSession: number;
  /** Maximum network requests per session */
  maxNetworkRequestsPerSession: number;
  /** Maximum screenshots stored per session */
  maxScreenshotsPerSession: number;
  /** Maximum observations stored per session */
  maxObservationsPerSession: number;
  /** Cleanup check interval in milliseconds */
  cleanupIntervalMs: number;
  /** Enable automatic stale session cleanup */
  enableAutoCleanup: boolean;
  /** Maximum session data size in bytes (actions + observations) */
  maxSessionDataSizeBytes: number;
}

export const DEFAULT_SESSION_SECURITY_CONFIG: SessionSecurityConfig = {
  maxSessionLifetimeMs: 30 * 60 * 1000,       // 30 minutes
  maxConcurrentSessions: 5,                     // Max 5 parallel sessions
  idleTimeoutMs: 5 * 60 * 1000,               // 5 minutes idle timeout
  maxMemoryPerSessionBytes: 256 * 1024 * 1024, // 256MB per session
  maxTotalMemoryBytes: 1024 * 1024 * 1024,     // 1GB total
  maxActionsPerSession: 200,                    // Max 200 actions
  maxNetworkRequestsPerSession: 1000,           // Max 1000 network requests
  maxScreenshotsPerSession: 50,                 // Max 50 screenshots
  maxObservationsPerSession: 100,               // Max 100 observations
  cleanupIntervalMs: 30 * 1000,                // Check every 30 seconds
  enableAutoCleanup: true,
  maxSessionDataSizeBytes: 100 * 1024 * 1024,  // 100MB session data
};

export interface SessionMetrics {
  sessionId: string;
  createdAt: Date;
  lastActivityAt: Date;
  actionCount: number;
  networkRequestCount: number;
  screenshotCount: number;
  observationCount: number;
  estimatedMemoryBytes: number;
  status: "active" | "idle" | "expired" | "overlimit";
}

export interface SessionSecurityEvent {
  type: "session_created" | "session_expired" | "session_killed" | "limit_exceeded" |
        "idle_timeout" | "memory_warning" | "cleanup_triggered";
  sessionId: string;
  timestamp: Date;
  details: Record<string, any>;
}

export type SessionSecurityEventCallback = (event: SessionSecurityEvent) => void;

export class SessionSecurityManager {
  private config: SessionSecurityConfig;
  private sessionMetrics: Map<string, SessionMetrics> = new Map();
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private eventCallbacks: Set<SessionSecurityEventCallback> = new Set();

  constructor(config: Partial<SessionSecurityConfig> = {}) {
    this.config = { ...DEFAULT_SESSION_SECURITY_CONFIG, ...config };

    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Check if a new session can be created
   */
  canCreateSession(): { allowed: boolean; reason?: string } {
    const activeSessions = this.getActiveSessions();

    if (activeSessions.length >= this.config.maxConcurrentSessions) {
      return {
        allowed: false,
        reason: `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached. Active: ${activeSessions.length}`,
      };
    }

    // Check total memory usage
    const totalMemory = activeSessions.reduce(
      (sum, m) => sum + m.estimatedMemoryBytes, 0
    );
    if (totalMemory >= this.config.maxTotalMemoryBytes) {
      return {
        allowed: false,
        reason: `Total memory limit (${this.formatBytes(this.config.maxTotalMemoryBytes)}) reached. Current: ${this.formatBytes(totalMemory)}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string): void {
    const now = new Date();
    this.sessionMetrics.set(sessionId, {
      sessionId,
      createdAt: now,
      lastActivityAt: now,
      actionCount: 0,
      networkRequestCount: 0,
      screenshotCount: 0,
      observationCount: 0,
      estimatedMemoryBytes: 0,
      status: "active",
    });

    this.emitEvent({
      type: "session_created",
      sessionId,
      timestamp: now,
      details: { activeSessions: this.sessionMetrics.size },
    });
  }

  /**
   * Record an action for a session
   */
  recordAction(sessionId: string): { allowed: boolean; reason?: string } {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return { allowed: false, reason: "Session not found" };

    metrics.lastActivityAt = new Date();
    metrics.actionCount++;

    if (metrics.actionCount > this.config.maxActionsPerSession) {
      metrics.status = "overlimit";
      this.emitEvent({
        type: "limit_exceeded",
        sessionId,
        timestamp: new Date(),
        details: { limit: "actions", count: metrics.actionCount, max: this.config.maxActionsPerSession },
      });
      return {
        allowed: false,
        reason: `Maximum actions per session (${this.config.maxActionsPerSession}) exceeded`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a network request for a session
   */
  recordNetworkRequest(sessionId: string): boolean {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return false;

    metrics.lastActivityAt = new Date();
    metrics.networkRequestCount++;

    if (metrics.networkRequestCount > this.config.maxNetworkRequestsPerSession) {
      this.emitEvent({
        type: "limit_exceeded",
        sessionId,
        timestamp: new Date(),
        details: { limit: "network_requests", count: metrics.networkRequestCount },
      });
      return false;
    }

    return true;
  }

  /**
   * Record a screenshot for a session
   */
  recordScreenshot(sessionId: string, sizeBytes: number): boolean {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return false;

    metrics.lastActivityAt = new Date();
    metrics.screenshotCount++;
    metrics.estimatedMemoryBytes += sizeBytes;

    if (metrics.screenshotCount > this.config.maxScreenshotsPerSession) {
      this.emitEvent({
        type: "limit_exceeded",
        sessionId,
        timestamp: new Date(),
        details: { limit: "screenshots", count: metrics.screenshotCount },
      });
      return false;
    }

    return true;
  }

  /**
   * Record an observation for a session
   */
  recordObservation(sessionId: string, sizeBytes: number = 0): boolean {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return false;

    metrics.lastActivityAt = new Date();
    metrics.observationCount++;
    metrics.estimatedMemoryBytes += sizeBytes;

    if (metrics.observationCount > this.config.maxObservationsPerSession) {
      return false;
    }

    return true;
  }

  /**
   * Update memory estimate for a session
   */
  updateMemoryEstimate(sessionId: string, bytes: number): void {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) return;

    metrics.estimatedMemoryBytes = bytes;

    if (bytes > this.config.maxMemoryPerSessionBytes) {
      metrics.status = "overlimit";
      this.emitEvent({
        type: "memory_warning",
        sessionId,
        timestamp: new Date(),
        details: {
          currentBytes: bytes,
          maxBytes: this.config.maxMemoryPerSessionBytes,
          utilization: (bytes / this.config.maxMemoryPerSessionBytes * 100).toFixed(1) + "%",
        },
      });
    }
  }

  /**
   * Check if a session has expired or is idle
   */
  checkSessionHealth(sessionId: string): {
    healthy: boolean;
    reason?: string;
    shouldTerminate: boolean;
  } {
    const metrics = this.sessionMetrics.get(sessionId);
    if (!metrics) {
      return { healthy: false, reason: "Session not found", shouldTerminate: true };
    }

    const now = Date.now();

    // Check lifetime expiry
    const lifetime = now - metrics.createdAt.getTime();
    if (lifetime > this.config.maxSessionLifetimeMs) {
      metrics.status = "expired";
      return {
        healthy: false,
        reason: `Session lifetime (${this.formatMs(this.config.maxSessionLifetimeMs)}) exceeded`,
        shouldTerminate: true,
      };
    }

    // Check idle timeout
    const idle = now - metrics.lastActivityAt.getTime();
    if (idle > this.config.idleTimeoutMs) {
      metrics.status = "idle";
      return {
        healthy: false,
        reason: `Session idle timeout (${this.formatMs(this.config.idleTimeoutMs)}) exceeded`,
        shouldTerminate: true,
      };
    }

    // Check memory limit
    if (metrics.estimatedMemoryBytes > this.config.maxMemoryPerSessionBytes) {
      return {
        healthy: false,
        reason: `Memory limit (${this.formatBytes(this.config.maxMemoryPerSessionBytes)}) exceeded`,
        shouldTerminate: true,
      };
    }

    // Check action limit
    if (metrics.actionCount > this.config.maxActionsPerSession) {
      return {
        healthy: false,
        reason: `Action limit (${this.config.maxActionsPerSession}) exceeded`,
        shouldTerminate: true,
      };
    }

    return { healthy: true, shouldTerminate: false };
  }

  /**
   * Get sessions that should be terminated
   */
  getSessionsToTerminate(): string[] {
    const toTerminate: string[] = [];

    for (const [sessionId] of this.sessionMetrics) {
      const health = this.checkSessionHealth(sessionId);
      if (health.shouldTerminate) {
        toTerminate.push(sessionId);
      }
    }

    return toTerminate;
  }

  /**
   * Get all active session metrics
   */
  getActiveSessions(): SessionMetrics[] {
    return Array.from(this.sessionMetrics.values()).filter(
      m => m.status === "active" || m.status === "idle"
    );
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): SessionMetrics | undefined {
    return this.sessionMetrics.get(sessionId);
  }

  /**
   * Unregister a session (called when session is properly closed)
   */
  unregisterSession(sessionId: string): void {
    this.sessionMetrics.delete(sessionId);
  }

  /**
   * Add event listener
   */
  addEventListener(callback: SessionSecurityEventCallback): void {
    this.eventCallbacks.add(callback);
  }

  /**
   * Remove event listener
   */
  removeEventListener(callback: SessionSecurityEventCallback): void {
    this.eventCallbacks.delete(callback);
  }

  /**
   * Start automatic cleanup of stale sessions
   */
  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const toTerminate = this.getSessionsToTerminate();

      if (toTerminate.length > 0) {
        this.emitEvent({
          type: "cleanup_triggered",
          sessionId: "system",
          timestamp: new Date(),
          details: { sessionsToTerminate: toTerminate.length, sessionIds: toTerminate },
        });
      }

      // Mark expired sessions (actual termination is handled by session manager)
      for (const sessionId of toTerminate) {
        const metrics = this.sessionMetrics.get(sessionId);
        if (metrics) {
          metrics.status = "expired";
        }
      }
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Get a summary of all session security metrics
   */
  getSummary(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
    totalMemoryBytes: number;
    memoryUtilization: string;
  } {
    const all = Array.from(this.sessionMetrics.values());
    const active = all.filter(m => m.status === "active");
    const expired = all.filter(m => m.status === "expired");
    const totalMemory = all.reduce((sum, m) => sum + m.estimatedMemoryBytes, 0);

    return {
      totalSessions: all.length,
      activeSessions: active.length,
      expiredSessions: expired.length,
      totalMemoryBytes: totalMemory,
      memoryUtilization: (totalMemory / this.config.maxTotalMemoryBytes * 100).toFixed(1) + "%",
    };
  }

  /**
   * Shutdown the security manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessionMetrics.clear();
    this.eventCallbacks.clear();
  }

  private emitEvent(event: SessionSecurityEvent): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (e) {
        console.error("[SessionSecurity] Event callback error:", e);
      }
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }

  private formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    return `${(ms / 60000).toFixed(0)}m`;
  }
}

export const sessionSecurity = new SessionSecurityManager();

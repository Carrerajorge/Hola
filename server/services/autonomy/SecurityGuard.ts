/**
 * Autonomous Security Guard Service
 *
 * Automatic security threat detection and prevention.
 * Implements improvements 61-75: Autonomous Security
 */

import { EventEmitter } from "events";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface ThreatInfo {
    ip: string;
    type: "brute_force" | "rate_limit" | "sql_injection" | "xss" | "suspicious" | "banned";
    attempts: number;
    firstSeen: Date;
    lastSeen: Date;
    blocked: boolean;
    blockedUntil?: Date;
}

interface AuditLog {
    id: string;
    timestamp: Date;
    userId?: string;
    ip: string;
    action: string;
    resource: string;
    details?: any;
    risk: "low" | "medium" | "high" | "critical";
}

interface SecurityRule {
    name: string;
    pattern: RegExp;
    type: "sql_injection" | "xss" | "path_traversal" | "command_injection";
    severity: "low" | "medium" | "high" | "critical";
}

interface RateLimitEntry {
    count: number;
    firstRequest: Date;
    lastRequest: Date;
}

// ============================================================================
// SECURITY GUARD SERVICE
// ============================================================================

export class SecurityGuardService extends EventEmitter {
    private threats: Map<string, ThreatInfo> = new Map();
    private auditLogs: AuditLog[] = [];
    private rateLimits: Map<string, Map<string, RateLimitEntry>> = new Map();
    private securityRules: SecurityRule[] = [];
    private csrfTokens: Map<string, { token: string; expires: Date }> = new Map();
    private sessionActivity: Map<string, Date> = new Map();

    // Config
    private readonly MAX_LOGIN_ATTEMPTS = 5;
    private readonly BLOCK_DURATION_MS = 900000; // 15 minutes
    private readonly INACTIVITY_TIMEOUT_MS = 1800000; // 30 minutes
    private readonly MAX_AUDIT_LOGS = 10000;
    private readonly RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

    constructor() {
        super();
        this.initializeSecurityRules();
        this.startCleanupJob();
        console.log("[SecurityGuard] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private initializeSecurityRules(): void {
        this.securityRules = [
            // SQL Injection patterns
            {
                name: "sql_union",
                pattern: /(\bunion\b.*\bselect\b)|(\bselect\b.*\bunion\b)/i,
                type: "sql_injection",
                severity: "critical"
            },
            {
                name: "sql_drop",
                pattern: /\bdrop\s+(table|database|index)\b/i,
                type: "sql_injection",
                severity: "critical"
            },
            {
                name: "sql_delete",
                pattern: /\bdelete\s+from\b/i,
                type: "sql_injection",
                severity: "high"
            },
            {
                name: "sql_comments",
                pattern: /(--|\/\*|\*\/|;--)/,
                type: "sql_injection",
                severity: "medium"
            },
            {
                name: "sql_or_bypass",
                pattern: /'\s*(or|and)\s*'?\d*'?\s*=\s*'?\d*'?/i,
                type: "sql_injection",
                severity: "critical"
            },

            // XSS patterns
            {
                name: "xss_script",
                pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/i,
                type: "xss",
                severity: "critical"
            },
            {
                name: "xss_event",
                pattern: /\bon\w+\s*=\s*["']?[^"']*["']?/i,
                type: "xss",
                severity: "high"
            },
            {
                name: "xss_javascript",
                pattern: /javascript\s*:/i,
                type: "xss",
                severity: "high"
            },
            {
                name: "xss_data",
                pattern: /data\s*:\s*text\/html/i,
                type: "xss",
                severity: "high"
            },

            // Path traversal
            {
                name: "path_traversal",
                pattern: /\.\.[\/\\]/,
                type: "path_traversal",
                severity: "high"
            },

            // Command injection
            {
                name: "cmd_injection",
                pattern: /[;&|`$]|\$\(|\)\s*{/,
                type: "command_injection",
                severity: "critical"
            }
        ];
    }

    private startCleanupJob(): void {
        // Clean up expired blocks and old data every 5 minutes
        setInterval(() => {
            this.cleanupExpiredBlocks();
            this.cleanupOldAuditLogs();
            this.cleanupExpiredCSRFTokens();
            this.cleanupInactiveSessions();
        }, 300000);
    }

    // ========================================================================
    // IP BLOCKING (Improvement #61)
    // ========================================================================

    recordLoginAttempt(ip: string, success: boolean, userId?: string): void {
        let threat = this.threats.get(ip);

        if (!threat) {
            threat = {
                ip,
                type: "brute_force",
                attempts: 0,
                firstSeen: new Date(),
                lastSeen: new Date(),
                blocked: false
            };
            this.threats.set(ip, threat);
        }

        threat.lastSeen = new Date();

        if (success) {
            // Reset on successful login
            threat.attempts = 0;
            this.audit(userId, ip, "login_success", "auth", { userId }, "low");
        } else {
            threat.attempts++;
            this.audit(userId, ip, "login_failed", "auth", { attempts: threat.attempts }, "medium");

            // Auto-block after too many failures
            if (threat.attempts >= this.MAX_LOGIN_ATTEMPTS) {
                this.blockIP(ip, "brute_force");
            }
        }
    }

    blockIP(ip: string, reason: ThreatInfo["type"]): void {
        let threat = this.threats.get(ip);

        if (!threat) {
            threat = {
                ip,
                type: reason,
                attempts: 0,
                firstSeen: new Date(),
                lastSeen: new Date(),
                blocked: false
            };
        }

        threat.blocked = true;
        threat.blockedUntil = new Date(Date.now() + this.BLOCK_DURATION_MS);
        threat.type = reason;

        this.threats.set(ip, threat);

        console.log(`[SecurityGuard] IP blocked: ${ip} (${reason}) until ${threat.blockedUntil}`);

        this.emit("ip_blocked", { ip, reason, until: threat.blockedUntil });
        this.audit(undefined, ip, "ip_blocked", "security", { reason }, "high");
    }

    unblockIP(ip: string): void {
        const threat = this.threats.get(ip);
        if (threat) {
            threat.blocked = false;
            threat.blockedUntil = undefined;
            threat.attempts = 0;
            console.log(`[SecurityGuard] IP unblocked: ${ip}`);
            this.audit(undefined, ip, "ip_unblocked", "security", {}, "medium");
        }
    }

    isIPBlocked(ip: string): boolean {
        const threat = this.threats.get(ip);
        if (!threat) return false;

        if (threat.blocked && threat.blockedUntil) {
            if (threat.blockedUntil > new Date()) {
                return true;
            } else {
                // Auto-unblock expired
                threat.blocked = false;
                threat.blockedUntil = undefined;
            }
        }

        return false;
    }

    private cleanupExpiredBlocks(): void {
        const now = new Date();
        for (const [ip, threat] of this.threats) {
            if (threat.blocked && threat.blockedUntil && threat.blockedUntil <= now) {
                threat.blocked = false;
                threat.blockedUntil = undefined;
            }
        }
    }

    // ========================================================================
    // RATE LIMITING (Improvement #62)
    // ========================================================================

    checkRateLimit(identifier: string, category: string, limit: number): {
        allowed: boolean;
        current: number;
        remaining: number;
        resetAt: Date;
    } {
        if (!this.rateLimits.has(category)) {
            this.rateLimits.set(category, new Map());
        }

        const categoryLimits = this.rateLimits.get(category)!;
        let entry = categoryLimits.get(identifier);

        const now = new Date();

        if (!entry || (now.getTime() - entry.firstRequest.getTime()) > this.RATE_LIMIT_WINDOW_MS) {
            entry = {
                count: 0,
                firstRequest: now,
                lastRequest: now
            };
        }

        entry.count++;
        entry.lastRequest = now;
        categoryLimits.set(identifier, entry);

        const resetAt = new Date(entry.firstRequest.getTime() + this.RATE_LIMIT_WINDOW_MS);
        const allowed = entry.count <= limit;
        const remaining = Math.max(0, limit - entry.count);

        if (!allowed) {
            this.emit("rate_limited", { identifier, category, count: entry.count, limit });
        }

        return { allowed, current: entry.count, remaining, resetAt };
    }

    // ========================================================================
    // INPUT VALIDATION (Improvements #72, #73)
    // ========================================================================

    validateInput(input: string, context: string = "general"): {
        safe: boolean;
        threats: Array<{ rule: string; type: string; severity: string }>;
        sanitized: string;
    } {
        const threats: Array<{ rule: string; type: string; severity: string }> = [];
        let sanitized = input;

        for (const rule of this.securityRules) {
            if (rule.pattern.test(input)) {
                threats.push({
                    rule: rule.name,
                    type: rule.type,
                    severity: rule.severity
                });

                // Log critical threats
                if (rule.severity === "critical") {
                    console.warn(`[SecurityGuard] Critical threat detected: ${rule.name} in ${context}`);
                    this.emit("threat_detected", { rule: rule.name, type: rule.type, context });
                }
            }
        }

        // Basic sanitization
        sanitized = this.sanitizeHTML(input);

        return {
            safe: threats.length === 0,
            threats,
            sanitized
        };
    }

    sanitizeHTML(input: string): string {
        return input
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#x27;")
            .replace(/\//g, "&#x2F;");
    }

    sanitizeSQL(input: string): string {
        return input
            .replace(/'/g, "''")
            .replace(/\\/g, "\\\\")
            .replace(/\x00/g, "\\0")
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\x1a/g, "\\Z");
    }

    // ========================================================================
    // CSRF PROTECTION (Improvement #74)
    // ========================================================================

    generateCSRFToken(sessionId: string): string {
        const token = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 3600000); // 1 hour

        this.csrfTokens.set(sessionId, { token, expires });

        return token;
    }

    validateCSRFToken(sessionId: string, token: string): boolean {
        const stored = this.csrfTokens.get(sessionId);

        if (!stored) return false;
        if (stored.expires < new Date()) {
            this.csrfTokens.delete(sessionId);
            return false;
        }

        const valid = crypto.timingSafeEqual(
            Buffer.from(stored.token),
            Buffer.from(token)
        );

        // Rotate token on successful validation
        if (valid) {
            this.generateCSRFToken(sessionId);
        }

        return valid;
    }

    private cleanupExpiredCSRFTokens(): void {
        const now = new Date();
        for (const [sessionId, data] of this.csrfTokens) {
            if (data.expires < now) {
                this.csrfTokens.delete(sessionId);
            }
        }
    }

    // ========================================================================
    // SESSION SECURITY (Improvement #67)
    // ========================================================================

    recordSessionActivity(sessionId: string): void {
        this.sessionActivity.set(sessionId, new Date());
    }

    isSessionActive(sessionId: string): boolean {
        const lastActivity = this.sessionActivity.get(sessionId);
        if (!lastActivity) return false;

        const elapsed = Date.now() - lastActivity.getTime();
        return elapsed < this.INACTIVITY_TIMEOUT_MS;
    }

    getInactiveSessions(): string[] {
        const inactive: string[] = [];
        const cutoff = Date.now() - this.INACTIVITY_TIMEOUT_MS;

        for (const [sessionId, lastActivity] of this.sessionActivity) {
            if (lastActivity.getTime() < cutoff) {
                inactive.push(sessionId);
            }
        }

        return inactive;
    }

    private cleanupInactiveSessions(): void {
        const inactive = this.getInactiveSessions();
        for (const sessionId of inactive) {
            this.sessionActivity.delete(sessionId);
            this.csrfTokens.delete(sessionId);
        }

        if (inactive.length > 0) {
            console.log(`[SecurityGuard] Cleaned up ${inactive.length} inactive sessions`);
        }
    }

    // ========================================================================
    // AUDIT LOGGING (Improvement #69)
    // ========================================================================

    audit(
        userId: string | undefined,
        ip: string,
        action: string,
        resource: string,
        details?: any,
        risk: AuditLog["risk"] = "low"
    ): void {
        const log: AuditLog = {
            id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date(),
            userId,
            ip,
            action,
            resource,
            details,
            risk
        };

        this.auditLogs.push(log);

        // Emit for real-time monitoring
        if (risk === "high" || risk === "critical") {
            this.emit("security_event", log);
        }
    }

    getAuditLogs(filters?: {
        userId?: string;
        ip?: string;
        action?: string;
        risk?: AuditLog["risk"];
        since?: Date;
        limit?: number;
    }): AuditLog[] {
        let logs = [...this.auditLogs];

        if (filters?.userId) {
            logs = logs.filter(l => l.userId === filters.userId);
        }
        if (filters?.ip) {
            logs = logs.filter(l => l.ip === filters.ip);
        }
        if (filters?.action) {
            logs = logs.filter(l => l.action === filters.action);
        }
        if (filters?.risk) {
            logs = logs.filter(l => l.risk === filters.risk);
        }
        if (filters?.since) {
            logs = logs.filter(l => l.timestamp >= filters.since!);
        }

        logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (filters?.limit) {
            logs = logs.slice(0, filters.limit);
        }

        return logs;
    }

    private cleanupOldAuditLogs(): void {
        if (this.auditLogs.length > this.MAX_AUDIT_LOGS) {
            this.auditLogs = this.auditLogs.slice(-this.MAX_AUDIT_LOGS);
        }
    }

    // ========================================================================
    // PASSWORD POLICY (Improvement #75)
    // ========================================================================

    validatePassword(password: string): {
        valid: boolean;
        score: number;
        issues: string[];
        suggestions: string[];
    } {
        const issues: string[] = [];
        const suggestions: string[] = [];
        let score = 0;

        // Length check
        if (password.length < 8) {
            issues.push("Mínimo 8 caracteres");
        } else if (password.length >= 12) {
            score += 2;
        } else {
            score += 1;
        }

        // Uppercase check
        if (!/[A-Z]/.test(password)) {
            issues.push("Incluir mayúsculas");
        } else {
            score += 1;
        }

        // Lowercase check
        if (!/[a-z]/.test(password)) {
            issues.push("Incluir minúsculas");
        } else {
            score += 1;
        }

        // Number check
        if (!/\d/.test(password)) {
            issues.push("Incluir números");
        } else {
            score += 1;
        }

        // Special character check
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            suggestions.push("Agregar caracteres especiales para mayor seguridad");
        } else {
            score += 2;
        }

        // Common password check
        const commonPasswords = [
            "password", "123456", "qwerty", "admin", "letmein",
            "welcome", "monkey", "dragon", "master", "login"
        ];
        if (commonPasswords.some(p => password.toLowerCase().includes(p))) {
            issues.push("No usar contraseñas comunes");
            score = Math.max(0, score - 2);
        }

        // Sequential characters check
        if (/(.)\1{2,}/.test(password) || /012|123|234|345|456|567|678|789|abc|bcd/i.test(password)) {
            issues.push("Evitar secuencias obvias");
            score = Math.max(0, score - 1);
        }

        return {
            valid: issues.length === 0 && score >= 3,
            score: Math.min(5, score),
            issues,
            suggestions
        };
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getThreats(): ThreatInfo[] {
        return Array.from(this.threats.values())
            .sort((a, b) => b.attempts - a.attempts);
    }

    getBlockedIPs(): string[] {
        return Array.from(this.threats.values())
            .filter(t => t.blocked)
            .map(t => t.ip);
    }

    getSecurityStatus(): {
        blockedIPs: number;
        activeThreats: number;
        recentAuditEvents: number;
        activeSessions: number;
    } {
        const oneHourAgo = new Date(Date.now() - 3600000);

        return {
            blockedIPs: this.getBlockedIPs().length,
            activeThreats: Array.from(this.threats.values()).filter(t => t.attempts > 0).length,
            recentAuditEvents: this.auditLogs.filter(l => l.timestamp > oneHourAgo).length,
            activeSessions: this.sessionActivity.size
        };
    }

    // Middleware helper
    createMiddleware() {
        return (req: any, res: any, next: any) => {
            const ip = req.ip || req.connection?.remoteAddress || "unknown";

            // Check if IP is blocked
            if (this.isIPBlocked(ip)) {
                this.audit(undefined, ip, "blocked_request", req.path, {}, "high");
                return res.status(403).json({ error: "IP blocked" });
            }

            // Rate limiting
            const rateCheck = this.checkRateLimit(ip, "global", 100);
            if (!rateCheck.allowed) {
                return res.status(429).json({
                    error: "Rate limit exceeded",
                    resetAt: rateCheck.resetAt
                });
            }

            // Record activity for session
            if (req.sessionID) {
                this.recordSessionActivity(req.sessionID);
            }

            next();
        };
    }
}

// Singleton instance
export const securityGuard = new SecurityGuardService();

export default securityGuard;

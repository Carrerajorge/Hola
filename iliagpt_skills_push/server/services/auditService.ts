import { Logger } from "../lib/logger";

export enum AuditAction {
    USER_LOGIN = "USER_LOGIN",
    USER_LOGOUT = "USER_LOGOUT",
    DELETE_PROJECT = "DELETE_PROJECT",
    EXPORT_DATA = "EXPORT_DATA",
    CHANGE_ROLE = "CHANGE_ROLE",
    API_KEY_UPDATE = "API_KEY_UPDATE",
    SYSTEM_CONFIG_CHANGE = "SYSTEM_CONFIG_CHANGE",
    SENSITIVE_FILE_ACCESS = "SENSITIVE_FILE_ACCESS"
}

export interface AuditLogEntry {
    action: AuditAction;
    userId: string; // or "system" or IP if unauthenticated
    resourceId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    timestamp: Date;
}

export class AuditService {
    /**
     * Logs a critical action to the security log.
     */
    static log(
        action: AuditAction,
        userId: string,
        details?: Record<string, any>,
        req?: any // Optional Express Request to extract IP/UA
    ) {
        const entry: AuditLogEntry = {
            action,
            userId,
            details,
            timestamp: new Date(),
            ipAddress: req?.ip,
            userAgent: req?.headers?.["user-agent"],
        };

        // Log to standard security logger (which redacts sensitive info)
        Logger.security(`[Audit] ${action} by ${userId}`, entry);

        // NOTE: For production environments, consider augmenting with:
        // - External audit service (AWS CloudTrail, Datadog Audit, etc.)
        // - Tamper-proof database table with immutable writes
        // Current implementation: Structured logging ensures ingestion by observability stack
    }
}

import { Request, Response, NextFunction } from "express";
import { db } from "../db";

import { auditLogs } from "../../shared/schema";
import { getSecureUserId } from "../lib/anonUserHelper";
import { Logger } from "../lib/logger";
import { redactSensitiveData } from "./redactionHelper";

export const auditMiddleware = (action: string, resourceExtractor: (req: Request) => string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        // Capture the original end function to log after response is sent (optional, but standard for audit)
        // For simplicity, we log on entry or success. Let's log on success (finish).

        res.on("finish", async () => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                try {
                    const userId = getSecureUserId(req);
                    const resource = resourceExtractor(req);
                    const ipAddress = req.ip || req.socket.remoteAddress;
                    const userAgent = req.get("user-agent");

                    await db.insert(auditLogs).values({
                        userId: userId || null, // Allow anonymous or system actions if needed, or null if not logged in
                        action,
                        resource,
                        details: {
                            method: req.method,
                            url: req.originalUrl,
                            body: req.method !== "GET" ? redactSensitiveData(req.body) : undefined,
                        },
                        ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
                        userAgent,
                        createdAt: new Date(),
                    });
                } catch (err) {
                    Logger.error("Failed to log audit event", err);
                }
            }
        });

        next();
    };
};

export const logAudit = async (
    userId: string | undefined,
    action: string,
    resource: string,
    details: any = {},
    req?: Request
) => {
    try {
        let ipAddress, userAgent;
        if (req) {
            ipAddress = req.ip || req.socket.remoteAddress;
            userAgent = req.get("user-agent");
        }

        await db.insert(auditLogs).values({
            userId: userId || null,
            action,
            resource,
            details,
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
            userAgent,
            createdAt: new Date(),
        });
    } catch (err) {
        Logger.error("Failed to log manual audit event", err);
    }
};
export const globalAuditMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    // Only log mutations (non-GET)
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }

    res.on("finish", async () => {
        try {
            const userId = getSecureUserId(req);
            const ipAddress = req.ip || req.socket.remoteAddress;
            const userAgent = req.get("user-agent");

            // We use a safe substring of URL as resource identifier
            const resource = req.baseUrl + req.path;

            await db.insert(auditLogs).values({
                userId: userId || null,
                action: `HTTP_${req.method}`,
                resource: resource.substring(0, 255), // Truncate to fit if needed, though text type is usually fine
                details: {
                    method: req.method,
                    url: req.originalUrl,
                    statusCode: res.statusCode,
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
                userAgent,
                createdAt: new Date(),
            });
        } catch (err) {
            Logger.error("Failed to log global audit event", err);
        }
    });
    next();
};

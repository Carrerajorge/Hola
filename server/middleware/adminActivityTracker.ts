/**
 * Admin Activity Tracker Middleware
 * Automatically logs all admin API actions
 */

import { Request, Response, NextFunction } from "express";
import { auditLog } from "../services/auditLogger";

// Actions that should be logged automatically
const LOGGED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// Paths that should not be logged (to avoid noise)
const EXCLUDED_PATHS = [
  "/api/admin/dashboard/realtime",
  "/api/admin/security/logs",
  "/api/admin/agent/gaps",
];

export function adminActivityTracker(req: Request, res: Response, next: NextFunction) {
  const fullPath = getAdminPath(req);

  // Only log modifying requests
  if (!LOGGED_METHODS.includes(req.method)) {
    return next();
  }

  // Skip excluded paths
  if (EXCLUDED_PATHS.some(path => fullPath.startsWith(path))) {
    return next();
  }

  // Store original end function
  const originalEnd = res.end;

  // Capture response
  res.end = function(chunk?: any, encoding?: any, callback?: any) {
    // Log after response is sent
    setImmediate(async () => {
      try {
        const actionPath = getCanonicalActionPath(fullPath);
        const action = `admin.${req.method.toLowerCase()}.${actionPath}`.slice(0, 120);
        
        await auditLog(req, {
          action,
          resource: extractResource(fullPath),
          resourceId: extractResourceId(fullPath),
          details: {
            method: req.method,
            path: fullPath,
            statusCode: res.statusCode,
            body: sanitizeBody(req.body),
          },
          category: "admin",
          severity: res.statusCode >= 400 ? "error" : "info"
        });
      } catch (error) {
        console.error("[AdminActivityTracker] Failed to log activity:", error);
      }
    });

    // Call original end
    return originalEnd.call(this, chunk, encoding, callback);
  };

  next();
}

function getAdminPath(req: Request): string {
  const baseUrl = req.baseUrl || "";
  const path = req.path || req.originalUrl || "/";
  const full = `${baseUrl}${path}` || "/";
  return full.replace(/\/{2,}/g, "/");
}

function getCanonicalActionPath(path: string): string {
  return path
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\//g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

/**
 * Extract resource type from path
 */
function extractResource(path: string): string {
  const parts = getAdminPathSegments(path);
  return parts[0] || "unknown";
}

/**
 * Extract resource ID from path if present
 */
function extractResourceId(path: string): string | undefined {
  const parts = getAdminPathSegments(path);
  // Check if second part looks like an ID
  if (parts[1] && !["stats", "list", "export", "bulk"].includes(parts[1])) {
    return parts[1];
  }
  return undefined;
}

function getAdminPathSegments(path: string): string[] {
  return path
    .replace(/^\/api\/admin\/?/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body: any): any {
  if (!body) return undefined;
  
  const sanitized = { ...body };
  
  // Remove sensitive fields
  const sensitiveFields = ["password", "apiKey", "secret", "token", "credentials"];
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }
  
  return sanitized;
}

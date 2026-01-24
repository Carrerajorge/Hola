import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { runWithContext, getTraceId as getTraceIdFromContext, CorrelationContext } from "./correlationContext";
import { createLogger } from "../utils/logger";

const logger = createLogger("http");

// SECURITY FIX #19: Sensitive query parameters to redact from logs
const SENSITIVE_QUERY_PARAMS = ['token', 'key', 'secret', 'password', 'apiKey', 'api_key', 'access_token', 'refresh_token', 'code', 'state'];

// SECURITY FIX #20: Sanitize query params for logging
function sanitizeQueryForLogging(query: Record<string, any>): Record<string, any> | undefined {
  if (!query || Object.keys(query).length === 0) return undefined;

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(query)) {
    if (SENSITIVE_QUERY_PARAMS.some(param => key.toLowerCase().includes(param.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function getTraceId(): string | undefined {
  return getTraceIdFromContext();
}

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const traceId = nanoid(16);
  const startTime = Date.now();

  res.setHeader("X-Trace-Id", traceId);
  res.locals.traceId = traceId;

  const context: CorrelationContext = {
    traceId,
    startTime,
    userId: (req as any).user?.id,
  };

  runWithContext(context, () => {
    const requestLogger = logger.child({ traceId });

    requestLogger.info("Request started", {
      method: req.method,
      path: req.path,
      // SECURITY FIX #21: Use sanitized query params
      query: sanitizeQueryForLogging(req.query as Record<string, any>),
      userAgent: req.get("user-agent"),
      ip: req.ip || req.socket.remoteAddress,
    });

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      res.setHeader("X-Response-Time", `${durationMs}ms`);

      const isError = res.statusCode >= 400;

      const logMethod = isError ? "warn" : "info";
      requestLogger[logMethod]("Request completed", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      });
    });

    res.on("error", (error: Error) => {
      const durationMs = Date.now() - startTime;
      requestLogger.error("Request error", {
        method: req.method,
        path: req.path,
        error: error.message,
        stack: error.stack,
        durationMs,
      });
    });

    next();
  });
}

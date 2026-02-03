import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { runWithContext, getTraceId as getTraceIdFromContext, CorrelationContext } from "./correlationContext";
import { createLogger } from "../utils/logger";

const logger = createLogger("http");
const REDACT_KEYS = new Set([
  "password",
  "pass",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "session",
]);

function redactQuery(query: Request["query"]) {
  if (!query || typeof query !== "object") {
    return query;
  }

  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }
      return [key, value];
    })
  );
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
      query: Object.keys(req.query).length > 0 ? redactQuery(req.query) : undefined,
      userAgent: req.get("user-agent"),
      ip: req.ip || req.socket.remoteAddress,
    });

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;

      // Headers are already sent by the time the 'finish' event fires.
      // Only set response headers before headers are sent.
      // (We still log duration here.)

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

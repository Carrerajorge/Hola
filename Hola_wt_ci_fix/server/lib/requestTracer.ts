import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { createLogger } from "./structuredLogger";

const logger = createLogger("request-tracer");

interface RequestInfo {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  userId?: string;
}

interface RequestStats {
  totalRequests: number;
  activeRequests: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  requestsPerMinute: number;
  byMethod: Record<string, number>;
  byPath: Record<string, number>;
  recentErrors: number;
}

const activeRequests: Map<string, RequestInfo> = new Map();
const requestHistory: { duration: number; timestamp: number; error: boolean }[] = [];
const REQUEST_HISTORY_MAX = 1000;
const STATS_WINDOW_MS = 60000; // 1 minuto

let totalRequests = 0;
let totalDuration = 0;
let maxDuration = 0;
let minDuration = Infinity;
const methodCounts: Record<string, number> = {};
const pathCounts: Record<string, number> = {};

export function requestTracerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = nanoid(16);
  const startTime = Date.now();
  
  // Almacenar requestId en res.locals para acceso en otras partes
  res.locals.requestId = requestId;
  
  const userId = (req as any).user?.id;
  
  const requestInfo: RequestInfo = {
    requestId,
    method: req.method,
    path: req.path,
    startTime,
    userId,
  };
  
  activeRequests.set(requestId, requestInfo);
  totalRequests++;
  
  // Contadores por método y path
  methodCounts[req.method] = (methodCounts[req.method] || 0) + 1;
  const normalizedPath = normalizePath(req.path);
  pathCounts[normalizedPath] = (pathCounts[normalizedPath] || 0) + 1;
  
  logger.withRequest(requestId, userId).info(`→ ${req.method} ${req.path}`, {
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    userAgent: req.get("user-agent"),
  });
  
  // Handler para cuando termina la respuesta
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    activeRequests.delete(requestId);
    
    // Actualizar estadísticas
    totalDuration += duration;
    maxDuration = Math.max(maxDuration, duration);
    minDuration = Math.min(minDuration, duration);
    
    const isError = res.statusCode >= 400;
    
    // Agregar al historial
    requestHistory.push({
      duration,
      timestamp: Date.now(),
      error: isError,
    });
    
    // Rotación del historial
    if (requestHistory.length > REQUEST_HISTORY_MAX) {
      requestHistory.splice(0, requestHistory.length - REQUEST_HISTORY_MAX);
    }
    
    const logMethod = isError ? "warn" : "info";
    logger.withRequest(requestId, userId).withDuration(duration)[logMethod](
      `← ${req.method} ${req.path} ${res.statusCode}`,
      { statusCode: res.statusCode }
    );
  });
  
  res.on("error", (error) => {
    const duration = Date.now() - startTime;
    activeRequests.delete(requestId);
    
    logger.withRequest(requestId, userId).error(`✗ ${req.method} ${req.path} ERROR`, {
      error: error.message,
      duration,
    });
  });
  
  next();
}

function normalizePath(path: string): string {
  // Normalizar paths con IDs dinámicos
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:id")
    .replace(/\/[a-zA-Z0-9_-]{16,}/g, "/:id");
}

export function getActiveRequests(): RequestInfo[] {
  return Array.from(activeRequests.values());
}

export function getActiveRequestsCount(): number {
  return activeRequests.size;
}

export function getRequestStats(): RequestStats {
  const now = Date.now();
  const recentWindow = now - STATS_WINDOW_MS;
  
  const recentRequests = requestHistory.filter(r => r.timestamp >= recentWindow);
  const recentErrors = recentRequests.filter(r => r.error).length;
  const requestsPerMinute = recentRequests.length;
  
  return {
    totalRequests,
    activeRequests: activeRequests.size,
    avgDurationMs: totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0,
    maxDurationMs: maxDuration === 0 ? 0 : maxDuration,
    minDurationMs: minDuration === Infinity ? 0 : minDuration,
    requestsPerMinute,
    byMethod: { ...methodCounts },
    byPath: { ...pathCounts },
    recentErrors,
  };
}

export function getRequestById(requestId: string): RequestInfo | undefined {
  return activeRequests.get(requestId);
}

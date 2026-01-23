import { nanoid } from "nanoid";

// Tipos para el sistema de logging estructurado
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  component: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  duration?: number;
}

export interface LogFilters {
  level?: LogLevel;
  component?: string;
  since?: Date;
  requestId?: string;
  userId?: string;
  limit?: number;
}

export interface LogStats {
  total: number;
  byLevel: Record<LogLevel, number>;
  byComponent: Record<string, number>;
  oldestEntry?: Date;
  newestEntry?: Date;
}

export interface Logger {
  debug: (message: string, metadata?: Record<string, any>) => void;
  info: (message: string, metadata?: Record<string, any>) => void;
  warn: (message: string, metadata?: Record<string, any>) => void;
  error: (message: string, metadata?: Record<string, any>) => void;
  withRequest: (requestId: string, userId?: string) => Logger;
  withDuration: (duration: number) => Logger;
}

const MAX_LOG_ENTRIES = 5000;
const logs: LogEntry[] = [];

function addLog(entry: Omit<LogEntry, "id" | "timestamp">): void {
  const logEntry: LogEntry = {
    ...entry,
    id: nanoid(12),
    timestamp: new Date(),
  };

  logs.push(logEntry);

  // Rotación: eliminar entradas antiguas si excedemos el límite
  if (logs.length > MAX_LOG_ENTRIES) {
    logs.splice(0, logs.length - MAX_LOG_ENTRIES);
  }

  // Use standardized logger for output
  const context = {
    component: logEntry.component,
    requestId: logEntry.requestId,
    userId: logEntry.userId,
    duration: logEntry.duration,
  };

  // Metadata merge
  const metadata = logEntry.metadata || {};

  switch (logEntry.level) {
    case "debug":
      baseLogger.debug(logEntry.message, { ...context, ...metadata });
      break;
    case "info":
      baseLogger.info(logEntry.message, { ...context, ...metadata });
      break;
    case "warn":
      baseLogger.warn(logEntry.message, { ...context, ...metadata });
      break;
    case "error":
      baseLogger.error(logEntry.message, { ...context, ...metadata });
      break;
  }
}

// Import base logger
import { logger as baseLogger } from "../utils/logger";

export function createLogger(component: string): Logger {
  let contextRequestId: string | undefined;
  let contextUserId: string | undefined;
  let contextDuration: number | undefined;

  const createLogMethod = (level: LogLevel) => {
    return (message: string, metadata?: Record<string, any>) => {
      addLog({
        level,
        message,
        component,
        requestId: contextRequestId,
        userId: contextUserId,
        duration: contextDuration,
        metadata,
      });
    };
  };

  const logger: Logger = {
    debug: createLogMethod("debug"),
    info: createLogMethod("info"),
    warn: createLogMethod("warn"),
    error: createLogMethod("error"),

    withRequest(requestId: string, userId?: string): Logger {
      const childLogger = createLogger(component);
      (childLogger as any)._setContext(requestId, userId, contextDuration);
      return childLogger;
    },

    withDuration(duration: number): Logger {
      const childLogger = createLogger(component);
      (childLogger as any)._setContext(contextRequestId, contextUserId, duration);
      return childLogger;
    },
  };

  (logger as any)._setContext = (reqId?: string, userId?: string, duration?: number) => {
    contextRequestId = reqId;
    contextUserId = userId;
    contextDuration = duration;
  };

  return logger;
}

export function getLogs(filters?: LogFilters): LogEntry[] {
  let result = [...logs];

  if (filters) {
    if (filters.level) {
      result = result.filter(log => log.level === filters.level);
    }
    if (filters.component) {
      result = result.filter(log => log.component === filters.component);
    }
    if (filters.since) {
      const sinceDate = new Date(filters.since);
      result = result.filter(log => log.timestamp >= sinceDate);
    }
    if (filters.requestId) {
      result = result.filter(log => log.requestId === filters.requestId);
    }
    if (filters.userId) {
      result = result.filter(log => log.userId === filters.userId);
    }
    if (filters.limit && filters.limit > 0) {
      result = result.slice(-filters.limit);
    }
  }

  return result;
}

export function getLogStats(): LogStats {
  const byLevel: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };

  const byComponent: Record<string, number> = {};

  for (const log of logs) {
    byLevel[log.level]++;
    byComponent[log.component] = (byComponent[log.component] || 0) + 1;
  }

  return {
    total: logs.length,
    byLevel,
    byComponent,
    oldestEntry: logs.length > 0 ? logs[0].timestamp : undefined,
    newestEntry: logs.length > 0 ? logs[logs.length - 1].timestamp : undefined,
  };
}

export function clearLogs(): void {
  logs.length = 0;
}

// Logger por defecto del sistema
export const systemLogger = createLogger("system");

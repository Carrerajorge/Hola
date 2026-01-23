import { getContext } from "../middleware/correlationContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'authorization', 'cookie', 'stripe'];

const redact = (obj: any): any => {
  if (!obj) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redact);

  const newObj: any = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
        newObj[key] = '***REDACTED***';
      } else {
        newObj[key] = redact(obj[key]);
      }
    }
  }
  return newObj;
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  userId?: string;
  component?: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface LoggerContext {
  component?: string;
  userId?: string;
  chatId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  child(context: LoggerContext): Logger;
}

function getConfiguredLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getConfiguredLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

function formatLogEntry(
  level: LogLevel,
  message: string,
  context: LoggerContext,
  metadata?: Record<string, unknown>
): LogEntry {
  const correlationContext = getContext();

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (correlationContext?.traceId) {
    entry.traceId = correlationContext.traceId;
  }

  if (correlationContext?.userId || context.userId) {
    entry.userId = context.userId || correlationContext?.userId;
  }

  if (context.component) {
    entry.component = context.component;
  }

  if (context.chatId) {
    entry.chatId = context.chatId;
  }

  const { component, userId, chatId, ...otherContext } = context;

  if (Object.keys(otherContext).length > 0) {
    Object.assign(entry, redact(otherContext));
  }

  if (metadata) {
    Object.assign(entry, redact(metadata));
  }

  return entry;
}

function writeLog(entry: LogEntry): void {
  const output = JSON.stringify(entry);

  switch (entry.level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "debug":
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

function createLogMethod(
  level: LogLevel,
  context: LoggerContext
): (message: string, metadata?: Record<string, unknown>) => void {
  return (message: string, metadata?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;

    const entry = formatLogEntry(level, message, context, metadata);
    writeLog(entry);
  };
}

function createLoggerWithContext(context: LoggerContext): Logger {
  return {
    debug: createLogMethod("debug", context),
    info: createLogMethod("info", context),
    warn: createLogMethod("warn", context),
    error: createLogMethod("error", context),
    child(childContext: LoggerContext): Logger {
      return createLoggerWithContext({ ...context, ...childContext });
    },
  };
}

export function createLogger(component?: string): Logger {
  return createLoggerWithContext({ component });
}

export const logger = createLogger();

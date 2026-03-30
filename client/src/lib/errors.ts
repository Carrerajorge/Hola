/**
 * Error Taxonomy
 * Categorización consistente de errores para manejo y tracking
 */

export type ErrorCategory =
  | "network"
  | "auth"
  | "timeout"
  | "validation"
  | "provider"
  | "upload"
  | "agent"
  | "document"
  | "runtime"
  | "unknown";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export interface ErrorContext {
  userId?: string;
  chatId?: string;
  messageId?: string;
  runId?: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export interface AppError extends Error {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: number;
  context?: ErrorContext;
  userMessage: string;
  technicalDetails?: string;
  retryable: boolean;
  retryCount: number;
}

export class BaseAppError extends Error implements AppError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: number;
  context?: ErrorContext;
  userMessage: string;
  technicalDetails?: string;
  retryable: boolean;
  retryCount: number;

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    options: {
      context?: ErrorContext;
      userMessage?: string;
      technicalDetails?: string;
      retryable?: boolean;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.id = `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.category = category;
    this.severity = severity;
    this.timestamp = Date.now();
    this.context = options.context;
    this.userMessage = options.userMessage || message;
    this.technicalDetails = options.technicalDetails;
    this.retryable = options.retryable ?? false;
    this.retryCount = 0;

    if (options.cause) {
      this.cause = options.cause;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      timestamp: this.timestamp,
      context: this.context,
      userMessage: this.userMessage,
      technicalDetails: this.technicalDetails,
      retryable: this.retryable,
      retryCount: this.retryCount,
      stack: this.stack,
      cause: this.cause instanceof Error
        ? { message: this.cause.message, name: this.cause.name }
        : undefined,
    };
  }
}

// Specific error classes
export class NetworkError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "network", "high", { ...options, retryable: true });
  }
}

export class AuthError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "auth", "critical", { ...options, retryable: false });
  }
}

export class TimeoutError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "timeout", "medium", { ...options, retryable: true });
  }
}

export class ValidationError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "validation", "low", { ...options, retryable: false });
  }
}

export class ProviderError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "provider", "high", { ...options, retryable: true });
  }
}

export class UploadError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "upload", "medium", { ...options, retryable: true });
  }
}

export class AgentError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "agent", "high", { ...options, retryable: false });
  }
}

export class DocumentError extends BaseAppError {
  constructor(
    message: string,
    options: Omit<ConstructorParameters<typeof BaseAppError>[3], "retryable"> = {}
  ) {
    super(message, "document", "medium", { ...options, retryable: false });
  }
}

// Error factory for converting generic errors
export function classifyError(error: unknown, context?: ErrorContext): AppError {
  if (error instanceof BaseAppError) {
    if (context) {
      error.context = { ...error.context, ...context };
    }
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  // Classify based on error message patterns
  if (message.match(/network|fetch|connection|offline/i)) {
    return new NetworkError(message, { context, cause });
  }

  if (message.match(/auth|unauthorized|token|login|session/i)) {
    return new AuthError(message, { context, cause });
  }

  if (message.match(/timeout|timed out|ETIMEDOUT/i)) {
    return new TimeoutError(message, { context, cause });
  }

  if (message.match(/validation|invalid|required|schema/i)) {
    return new ValidationError(message, { context, cause });
  }

  if (message.match(/provider|api|openai|anthropic|model/i)) {
    return new ProviderError(message, { context, cause });
  }

  if (message.match(/upload|file|multipart/i)) {
    return new UploadError(message, { context, cause });
  }

  if (message.match(/agent|run|execution|step/i)) {
    return new AgentError(message, { context, cause });
  }

  if (message.match(/document|word|excel|pdf|ppt/i)) {
    return new DocumentError(message, { context, cause });
  }

  // Default to unknown
  return new BaseAppError(message, "unknown", "medium", { context, cause });
}

// User-friendly error messages
export function getUserErrorMessage(error: AppError): string {
  const messages: Record<ErrorCategory, string> = {
    network: "Problema de conexión. Por favor, verifica tu internet e intenta de nuevo.",
    auth: "Tu sesión ha expirado. Por favor, inicia sesión nuevamente.",
    timeout: "La operación tomó demasiado tiempo. Por favor, intenta de nuevo.",
    validation: "Hay un problema con los datos ingresados. Por favor, verifica e intenta de nuevo.",
    provider: "El servicio de IA está experimentando problemas. Por favor, intenta de nuevo en un momento.",
    upload: "Hubo un problema al subir el archivo. Por favor, intenta de nuevo.",
    agent: "El agente encontró un problema al procesar tu solicitud. Por favor, intenta de nuevo.",
    document: "Hubo un problema al procesar el documento. Por favor, intenta de nuevo.",
    runtime: "Ocurrió un error inesperado. Por favor, recarga la página e intenta de nuevo.",
    unknown: "Ocurrió un error inesperado. Por favor, intenta de nuevo.",
  };

  return error.userMessage || messages[error.category] || messages.unknown;
}

// Retry strategy
export function shouldRetry(error: AppError, maxRetries: number = 3): boolean {
  if (!error.retryable) return false;
  if (error.retryCount >= maxRetries) return false;
  
  // Don't retry auth errors
  if (error.category === "auth") return false;
  
  // Don't retry validation errors
  if (error.category === "validation") return false;
  
  return true;
}

export function incrementRetryCount(error: AppError): AppError {
  error.retryCount++;
  return error;
}

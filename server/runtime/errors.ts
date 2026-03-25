export class RuntimeError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(message: string, code = "RUNTIME_ERROR", statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotSupportedError extends RuntimeError {
  constructor(message = "Operation not supported", details?: Record<string, unknown>) {
    super(message, "NOT_SUPPORTED", 501, details);
  }
}

export class NotFoundError extends RuntimeError {
  constructor(message = "Resource not found", details?: Record<string, unknown>) {
    super(message, "NOT_FOUND", 404, details);
  }
}

export class ValidationRuntimeError extends RuntimeError {
  constructor(message = "Invalid request", details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

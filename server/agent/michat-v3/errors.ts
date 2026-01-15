export type MichatErrorCode =
  | "E_TIMEOUT"
  | "E_RATE_LIMIT"
  | "E_CIRCUIT_OPEN"
  | "E_POLICY_DENIED"
  | "E_TOOL_NOT_FOUND"
  | "E_AGENT_NOT_FOUND"
  | "E_BAD_PARAMS"
  | "E_LLM"
  | "E_WORKFLOW_DAG"
  | "E_INTERNAL";

export class MichatError extends Error {
  readonly code: MichatErrorCode;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
  readonly isRetryable: boolean;

  constructor(
    code: MichatErrorCode,
    message: string,
    context: Record<string, unknown> = {}
  ) {
    super(`[${code}] ${message}`);
    this.name = "MichatError";
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.isRetryable = this.determineRetryable(code);
    Object.setPrototypeOf(this, MichatError.prototype);
  }

  private determineRetryable(code: MichatErrorCode): boolean {
    const nonRetryableCodes: MichatErrorCode[] = [
      "E_POLICY_DENIED",
      "E_TOOL_NOT_FOUND",
      "E_AGENT_NOT_FOUND",
      "E_BAD_PARAMS",
      "E_WORKFLOW_DAG",
    ];
    return !nonRetryableCodes.includes(code);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      isRetryable: this.isRetryable,
      stack: this.stack,
    };
  }

  static isRateLimitError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_RATE_LIMIT";
  }

  static isCircuitOpenError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_CIRCUIT_OPEN";
  }

  static isTimeoutError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_TIMEOUT";
  }

  static isPolicyError(err: unknown): err is MichatError {
    return err instanceof MichatError && err.code === "E_POLICY_DENIED";
  }

  static isMichatError(err: unknown): err is MichatError {
    return err instanceof MichatError;
  }
}

export function wrapError(err: unknown, fallbackCode: MichatErrorCode = "E_INTERNAL"): MichatError {
  if (err instanceof MichatError) {
    return err;
  }
  
  const message = err instanceof Error 
    ? err.message 
    : typeof err === "string" 
      ? err 
      : "Unknown error";
  
  return new MichatError(fallbackCode, message, {
    originalError: err instanceof Error ? err.name : typeof err,
    stack: err instanceof Error ? err.stack : undefined,
  });
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the i18n dependency
vi.mock("@/lib/i18n", () => ({
  t: vi.fn((key: string) => key),
}));

import {
  ErrorType,
  ErrorSeverity,
  createAppError,
  formatErrorForToast,
  logError,
  handleError,
  withRetry,
  createErrorFallbackProps,
} from "@/lib/error-handling";
import type { AppError } from "@/lib/error-handling";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  // Mock fetch so sendToErrorTracking doesn't make real calls
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
});

describe("createAppError", () => {
  it("creates NETWORK error from TypeError with 'fetch' in message", () => {
    const error = new TypeError("Failed to fetch");
    const appError = createAppError(error);
    expect(appError.type).toBe(ErrorType.NETWORK);
    expect(appError.severity).toBe(ErrorSeverity.ERROR);
    expect(appError.recoverable).toBe(true);
    expect(appError.retryable).toBe(true);
    expect(appError.originalError).toBe(error);
  });

  it("creates TIMEOUT error from AbortError", () => {
    const realError = new Error("The operation was aborted");
    realError.name = "AbortError";
    const appError = createAppError(realError);
    expect(appError.type).toBe(ErrorType.TIMEOUT);
    expect(appError.severity).toBe(ErrorSeverity.WARNING);
    expect(appError.retryable).toBe(true);
  });

  it("creates TIMEOUT error from error with 'timeout' in message", () => {
    const error = new Error("Request timeout after 30s");
    const appError = createAppError(error);
    expect(appError.type).toBe(ErrorType.TIMEOUT);
    expect(appError.retryable).toBe(true);
  });

  it("creates CLIENT error for generic Error", () => {
    const error = new Error("Something broke");
    const appError = createAppError(error);
    expect(appError.type).toBe(ErrorType.CLIENT);
    expect(appError.severity).toBe(ErrorSeverity.ERROR);
    expect(appError.retryable).toBe(false);
    expect(appError.message).toBe("Something broke");
  });

  it("includes context details in CLIENT error", () => {
    const error = new Error("render failed");
    const appError = createAppError(error, { component: "Dashboard", action: "load" });
    expect(appError.details).toEqual({ component: "Dashboard", action: "load" });
  });

  it("creates error from API-style object with message and status", () => {
    const apiError = { message: "Rate limited", code: "RATE_001", status: 429 };
    const appError = createAppError(apiError);
    expect(appError.type).toBe(ErrorType.RATE_LIMIT);
    expect(appError.code).toBe("RATE_001");
    expect(appError.message).toBe("Rate limited");
  });

  it("creates SERVER error from API object without status", () => {
    const apiError = { message: "Internal failure" };
    const appError = createAppError(apiError);
    expect(appError.type).toBe(ErrorType.SERVER);
  });

  it("creates UNKNOWN error from non-object/non-Error values", () => {
    const appError = createAppError("plain string error");
    expect(appError.type).toBe(ErrorType.UNKNOWN);
    expect(appError.message).toBe("plain string error");
    expect(appError.recoverable).toBe(true);
    expect(appError.retryable).toBe(true);
  });

  it("creates UNKNOWN error from null", () => {
    const appError = createAppError(null);
    expect(appError.type).toBe(ErrorType.UNKNOWN);
    expect(appError.message).toBe("null");
  });

  it("creates UNKNOWN error from number", () => {
    const appError = createAppError(42);
    expect(appError.type).toBe(ErrorType.UNKNOWN);
    expect(appError.message).toBe("42");
  });

  it("includes timestamp on all errors", () => {
    const before = new Date();
    const appError = createAppError(new Error("test"));
    const after = new Date();
    expect(appError.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(appError.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe("createAppError - HTTP status mapping", () => {
  it("maps 400 to VALIDATION", () => {
    const appError = createAppError({ message: "Bad request", status: 400 });
    expect(appError.type).toBe(ErrorType.VALIDATION);
  });

  it("maps 401 to AUTHENTICATION", () => {
    const appError = createAppError({ message: "Unauthorized", status: 401 });
    expect(appError.type).toBe(ErrorType.AUTHENTICATION);
  });

  it("maps 403 to AUTHORIZATION", () => {
    const appError = createAppError({ message: "Forbidden", status: 403 });
    expect(appError.type).toBe(ErrorType.AUTHORIZATION);
  });

  it("maps 404 to NOT_FOUND", () => {
    const appError = createAppError({ message: "Not found", status: 404 });
    expect(appError.type).toBe(ErrorType.NOT_FOUND);
  });

  it("maps 408 to TIMEOUT", () => {
    const appError = createAppError({ message: "Timeout", status: 408 });
    expect(appError.type).toBe(ErrorType.TIMEOUT);
  });

  it("maps 429 to RATE_LIMIT", () => {
    const appError = createAppError({ message: "Too many", status: 429 });
    expect(appError.type).toBe(ErrorType.RATE_LIMIT);
  });

  it("maps 500+ to SERVER", () => {
    const appError = createAppError({ message: "Server error", status: 502 });
    expect(appError.type).toBe(ErrorType.SERVER);
  });

  it("maps other 4xx to CLIENT", () => {
    const appError = createAppError({ message: "Conflict", status: 409 });
    expect(appError.type).toBe(ErrorType.CLIENT);
  });
});

describe("formatErrorForToast", () => {
  function makeAppError(overrides: Partial<AppError> = {}): AppError {
    return {
      type: ErrorType.NETWORK,
      severity: ErrorSeverity.ERROR,
      message: "Network error",
      userMessage: "Connection failed",
      recoverable: true,
      retryable: true,
      timestamp: new Date(),
      ...overrides,
    };
  }

  it("returns correct title from error type", () => {
    const toast = formatErrorForToast(makeAppError({ type: ErrorType.NETWORK }));
    expect(toast.title).toBe("Error de conexión");
  });

  it("uses userMessage as description", () => {
    const toast = formatErrorForToast(
      makeAppError({ userMessage: "Custom user message" })
    );
    expect(toast.description).toBe("Custom user message");
  });

  it("returns destructive variant for CRITICAL severity", () => {
    const toast = formatErrorForToast(
      makeAppError({ severity: ErrorSeverity.CRITICAL })
    );
    expect(toast.variant).toBe("destructive");
  });

  it("returns default variant for non-critical severity", () => {
    const toast = formatErrorForToast(
      makeAppError({ severity: ErrorSeverity.ERROR })
    );
    expect(toast.variant).toBe("default");
  });

  it("uses 10000ms duration for CRITICAL errors", () => {
    const toast = formatErrorForToast(
      makeAppError({ severity: ErrorSeverity.CRITICAL })
    );
    expect(toast.duration).toBe(10000);
  });

  it("uses 5000ms duration for non-critical errors by default", () => {
    const toast = formatErrorForToast(
      makeAppError({ severity: ErrorSeverity.WARNING })
    );
    expect(toast.duration).toBe(5000);
  });

  it("respects custom duration from options", () => {
    const toast = formatErrorForToast(makeAppError(), { duration: 3000 });
    expect(toast.duration).toBe(3000);
  });

  it("passes action through from options", () => {
    const action = { label: "Retry", onClick: vi.fn() };
    const toast = formatErrorForToast(makeAppError(), { action });
    expect(toast.action).toBe(action);
  });
});

describe("logError", () => {
  it("calls console.error for CRITICAL severity", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const appError: AppError = {
      type: ErrorType.SERVER,
      severity: ErrorSeverity.CRITICAL,
      message: "Server down",
      userMessage: "Server error",
      recoverable: false,
      retryable: false,
      timestamp: new Date(),
    };
    logError(appError);
    expect(spy).toHaveBeenCalledWith("[CRITICAL ERROR]", expect.any(Object));
  });

  it("calls console.warn for WARNING severity", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const appError: AppError = {
      type: ErrorType.TIMEOUT,
      severity: ErrorSeverity.WARNING,
      message: "Timeout",
      userMessage: "Timeout",
      recoverable: true,
      retryable: true,
      timestamp: new Date(),
    };
    logError(appError);
    expect(spy).toHaveBeenCalledWith("[WARNING]", expect.any(Object));
  });

  it("calls console.info for INFO severity", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const appError: AppError = {
      type: ErrorType.VALIDATION,
      severity: ErrorSeverity.INFO,
      message: "Validation",
      userMessage: "Invalid",
      recoverable: true,
      retryable: false,
      timestamp: new Date(),
    };
    logError(appError);
    expect(spy).toHaveBeenCalledWith("[INFO]", expect.any(Object));
  });
});

describe("handleError", () => {
  it("creates AppError, logs it, formats toast, and calls onDisplay", () => {
    const onDisplay = vi.fn();
    const error = new TypeError("Failed to fetch");

    const appError = handleError(error, onDisplay);

    expect(appError.type).toBe(ErrorType.NETWORK);
    expect(onDisplay).toHaveBeenCalledTimes(1);
    expect(onDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        description: expect.any(String),
        variant: expect.any(String),
      })
    );
  });

  it("passes context to logError", () => {
    const onDisplay = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    handleError(new Error("test"), onDisplay, {
      context: { component: "TestComp" },
    });

    expect(spy).toHaveBeenCalled();
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first successful call", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors and succeeds", async () => {
    const networkError = new TypeError("Failed to fetch");
    const fn = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce("recovered");

    const promise = withRetry(fn, { maxRetries: 3, initialDelay: 100, maxDelay: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const error = new TypeError("Failed to fetch");
    const fn = vi.fn().mockRejectedValue(error);

    let caughtError: unknown = null;
    const promise = withRetry(fn, { maxRetries: 2, initialDelay: 50, maxDelay: 200 })
      .catch((err) => { caughtError = err; });
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(caughtError).toBeInstanceOf(TypeError);
    expect((caughtError as Error).message).toBe("Failed to fetch");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const error = new Error("Validation failed");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelay: 50 })
    ).rejects.toThrow("Validation failed");

    // Client errors are not retryable, so only 1 call
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback for each retry", async () => {
    const onRetry = vi.fn();
    const error = new TypeError("Failed to fetch");
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 50,
      maxDelay: 500,
      onRetry,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[1][0]).toBe(2);
  });
});

describe("createErrorFallbackProps", () => {
  it("wraps Error into AppError with resetError callback", () => {
    const error = new Error("Component crashed");
    const resetFn = vi.fn();

    const props = createErrorFallbackProps(error, resetFn);

    expect(props.error.type).toBe(ErrorType.CLIENT);
    expect(props.error.message).toBe("Component crashed");
    expect(props.error.timestamp).toBeDefined();
    expect(props.resetError).toBe(resetFn);
  });

  it("handles network-style Error", () => {
    const error = new TypeError("Failed to fetch");
    const props = createErrorFallbackProps(error, vi.fn());
    expect(props.error.type).toBe(ErrorType.NETWORK);
  });
});

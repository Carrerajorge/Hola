import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchWithRetry,
  fetchJsonWithRetry,
  postJsonWithRetry,
  FetchError,
  TimeoutError,
} from "@/lib/fetchWithRetry";
import type { RetryOptions } from "@/lib/fetchWithRetry";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper to create a mock Response
function mockResponse(status: number, body: unknown = {}, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "",
    clone: () => mockResponse(status, body, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(body)),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as unknown as Response;
}

// Helper to advance timers through retries
async function flushRetries(count: number) {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(60_000);
  }
}

describe("fetchWithRetry", () => {
  it("returns response on successful fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { data: "ok" }));
    const res = await fetchWithRetry("/api/test");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it("passes RequestInit options through to fetch", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await fetchWithRetry("/api/test", {
      method: "POST",
      headers: { "X-Custom": "value" },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe("/api/test");
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].headers["X-Custom"]).toBe("value");
  });

  it("retries on retryable HTTP status codes and eventually succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(503, {}, "Service Unavailable"))
      .mockResolvedValueOnce(mockResponse(200, { success: true }));

    const promise = fetchWithRetry("/api/test", undefined, {
      maxRetries: 3,
      baseDelay: 100,
      maxDelay: 500,
      timeout: 30000,
    });

    // Advance past the retry delay
    await flushRetries(1);

    const res = await promise;
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws FetchError after exhausting all retries on retryable status", async () => {
    mockFetch.mockResolvedValue(mockResponse(500, {}, "Internal Server Error"));

    let caughtError: unknown = null;
    const promise = fetchWithRetry("/api/test", undefined, {
      maxRetries: 2,
      baseDelay: 50,
      maxDelay: 200,
      timeout: 30000,
    }).catch((err) => { caughtError = err; });

    await flushRetries(3);
    await promise;

    expect(caughtError).toBeInstanceOf(FetchError);
    // 1 initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-retryable status codes (e.g., 404)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(404, {}, "Not Found"));

    const res = await fetchWithRetry("/api/test", undefined, {
      maxRetries: 3,
      baseDelay: 50,
      timeout: 30000,
    });

    // 404 is not in retryStatusCodes, so it should be returned directly
    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network TypeError (fetch failed)", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test", undefined, {
      maxRetries: 2,
      baseDelay: 50,
      maxDelay: 200,
      timeout: 30000,
    });

    await flushRetries(1);
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback for each retry attempt", async () => {
    const onRetry = vi.fn();
    mockFetch
      .mockResolvedValueOnce(mockResponse(502, {}, "Bad Gateway"))
      .mockResolvedValueOnce(mockResponse(502, {}, "Bad Gateway"))
      .mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test", undefined, {
      maxRetries: 3,
      baseDelay: 50,
      maxDelay: 200,
      timeout: 30000,
      onRetry,
    });

    await flushRetries(3);
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1); // first retry attempt number
    expect(onRetry.mock.calls[1][0]).toBe(2); // second retry attempt number
  });

  it("does not retry when user abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("User cancelled");

    mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    await expect(
      fetchWithRetry("/api/test", undefined, {
        maxRetries: 3,
        baseDelay: 50,
        timeout: 30000,
        signal: controller.signal,
      })
    ).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("respects custom retryStatusCodes option", async () => {
    // Need two responses: initial 418 + retry 418 (both retryable), then it throws
    mockFetch
      .mockResolvedValueOnce(mockResponse(418, {}, "I'm a teapot"))
      .mockResolvedValueOnce(mockResponse(418, {}, "I'm a teapot"));

    let caughtError: unknown = null;
    const promise = fetchWithRetry("/api/test", undefined, {
      maxRetries: 1,
      baseDelay: 50,
      maxDelay: 100,
      timeout: 30000,
      retryStatusCodes: [418],
    }).catch((err) => { caughtError = err; });

    await flushRetries(2);
    await promise;

    expect(caughtError).toBeInstanceOf(FetchError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns non-ok response directly if status is not in retryStatusCodes", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, {}, "Bad Request"));

    const res = await fetchWithRetry("/api/test");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });
});

describe("FetchError", () => {
  it("has correct name and status properties", () => {
    const error = new FetchError("HTTP 500", 500, "Internal Server Error", undefined, 3);
    expect(error.name).toBe("FetchError");
    expect(error.message).toBe("HTTP 500");
    expect(error.status).toBe(500);
    expect(error.statusText).toBe("Internal Server Error");
    expect(error.attempts).toBe(3);
    expect(error).toBeInstanceOf(Error);
  });

  it("works without optional fields", () => {
    const error = new FetchError("Something failed");
    expect(error.status).toBeUndefined();
    expect(error.statusText).toBeUndefined();
    expect(error.response).toBeUndefined();
    expect(error.attempts).toBeUndefined();
  });
});

describe("TimeoutError", () => {
  it("stores the timeout duration", () => {
    const error = new TimeoutError("timed out", 5000);
    expect(error.name).toBe("TimeoutError");
    expect(error.timeoutMs).toBe(5000);
    expect(error.message).toBe("timed out");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("fetchJsonWithRetry", () => {
  it("parses JSON response and returns typed data", async () => {
    const body = { id: 1, name: "test" };
    mockFetch.mockResolvedValueOnce(mockResponse(200, body));

    const data = await fetchJsonWithRetry<{ id: number; name: string }>("/api/data");
    expect(data).toEqual(body);
  });

  it("includes Accept: application/json header", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, {}));

    await fetchJsonWithRetry("/api/data");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Accept).toBe("application/json");
  });

  it("throws FetchError for non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403, {}, "Forbidden"));

    await expect(fetchJsonWithRetry("/api/data")).rejects.toThrow(FetchError);
  });
});

describe("postJsonWithRetry", () => {
  it("sends POST with JSON body and returns parsed response", async () => {
    const requestBody = { username: "alice" };
    const responseBody = { success: true, id: 42 };
    mockFetch.mockResolvedValueOnce(mockResponse(200, responseBody));

    const result = await postJsonWithRetry<typeof requestBody, typeof responseBody>(
      "/api/users",
      requestBody
    );

    expect(result).toEqual(responseBody);
    const callInit = mockFetch.mock.calls[0][1];
    expect(callInit.method).toBe("POST");
    expect(callInit.body).toBe(JSON.stringify(requestBody));
    expect(callInit.headers["Content-Type"]).toBe("application/json");
  });

  it("propagates retry options to underlying fetch", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(500, {}, "Server Error"))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = postJsonWithRetry("/api/test", { data: 1 }, {
      maxRetries: 2,
      baseDelay: 50,
      maxDelay: 100,
      timeout: 30000,
    });

    await flushRetries(2);
    const result = await promise;
    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

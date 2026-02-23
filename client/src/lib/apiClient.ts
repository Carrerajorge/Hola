import { getStoredAnonUserId, getStoredAnonToken } from "@/hooks/use-auth";

// FRONTEND FIX #11: Safer cookie parsing helper
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function resolveSafeUrl(url: string): string {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) {
    throw new Error("Cross-origin requests are not allowed");
  }
  return target.toString();
}

function generateRequestId(): string {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${now}_${crypto.randomUUID()}`;
  }
  return `req_${now}_${random}`;
}

export async function apiFetch(url: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const safeUrl = resolveSafeUrl(url);
  const anonUserId = getStoredAnonUserId();
  const anonToken = getStoredAnonToken();

  const { timeoutMs, headers: optionsHeaders, ...fetchOptions } = options;
  const headers = new Headers(optionsHeaders);

  if (anonUserId) {
    headers.set("X-Anonymous-User-Id", anonUserId);
  }
  if (anonToken) {
    headers.set("X-Anonymous-Token", anonToken);
  }

  // FRONTEND FIX #12: Use safer cookie parsing for CSRF token
  const csrfToken = getCookie("XSRF-TOKEN");

  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const existingRequestId = headers.get("X-Request-Id") || headers.get("x-request-id");
  const requestId = existingRequestId || generateRequestId();
  if (!existingRequestId) {
    headers.set("X-Request-Id", requestId);
  }
  if (!headers.has("X-Correlation-Id") && !headers.has("x-correlation-id")) {
    headers.set("X-Correlation-Id", requestId);
  }

  const finalOptions: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: "include",
  };

  if (timeoutMs && timeoutMs > 0) {
    if ('timeout' in AbortSignal) {
      finalOptions.signal = AbortSignal.timeout(timeoutMs);
    } else {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
      finalOptions.signal = controller.signal;
    }
  }

  const fetchPromise = fetch(safeUrl, finalOptions);

  if (timeoutMs && timeoutMs > 0) {
    const timeoutPromise = new Promise<Response>((_, reject) => {
      setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
    });
    return Promise.race([fetchPromise, timeoutPromise]);
  }

  return fetchPromise;
}

export function getAnonUserIdHeader(): Record<string, string> {
  const anonUserId = getStoredAnonUserId();
  const anonToken = getStoredAnonToken();
  const headers: Record<string, string> = {};
  if (anonUserId) {
    headers["X-Anonymous-User-Id"] = anonUserId;
  }
  if (anonToken) {
    headers["X-Anonymous-Token"] = anonToken;
  }

  // FRONTEND FIX #13: Use safer cookie parsing helper
  const csrfToken = getCookie("XSRF-TOKEN");

  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  return headers;
}

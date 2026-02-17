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

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const safeUrl = resolveSafeUrl(url);
  const anonUserId = getStoredAnonUserId();
  const anonToken = getStoredAnonToken();
  const headers = new Headers(options.headers);

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

  return fetch(safeUrl, {
    ...options,
    headers,
    credentials: "include",
  });
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

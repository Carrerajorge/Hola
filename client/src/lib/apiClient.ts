import { getStoredAnonUserId, getStoredAnonToken } from "@/hooks/use-auth";

// FRONTEND FIX #11: Safer cookie parsing helper
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
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

  return fetch(url, {
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

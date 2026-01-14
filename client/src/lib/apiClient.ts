import { getStoredAnonUserId, getStoredAnonToken } from "@/hooks/use-auth";

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
  return headers;
}

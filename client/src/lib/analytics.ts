import { apiFetch } from "@/lib/apiClient";

export type AnalyticsEventPayload = {
  eventType: "page_view" | "action";
  page?: string;
  action?: string;
  metadata?: Record<string, any>;
  sessionId?: string;
};

const SESSION_KEY = "ilia_workspace_analytics_session";

export function getAnalyticsSessionId(): string {
  if (typeof window === "undefined") {
    return `session_${Date.now()}`;
  }

  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
  } catch {
    // ignore storage failures
  }

  let id = "";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    id = crypto.randomUUID();
  } else {
    id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    // ignore storage failures
  }

  return id;
}

export async function trackWorkspaceEvent(payload: AnalyticsEventPayload): Promise<void> {
  if (typeof window === "undefined") return;

  const sessionId = payload.sessionId || getAnalyticsSessionId();
  try {
    await apiFetch("/api/workspace/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        ...payload,
      }),
    });
  } catch {
    // Avoid blocking UI on tracking failures
  }
}

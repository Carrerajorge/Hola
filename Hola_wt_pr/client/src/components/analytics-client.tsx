import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/apiClient";

function getOrCreateSessionId(): string {
  const key = "iliagpt_analytics_session_id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "unknown";
  }
}

export function AnalyticsClient() {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const lastTrackedRef = useRef<string | null>(null);

  const { data: privacyData } = useQuery<{
    privacySettings: { analyticsTracking?: boolean };
  }>({
    queryKey: ["/api/users", userId, "privacy"],
    queryFn: async () => {
      const res = await apiFetch(`/api/users/${userId}/privacy`);
      if (!res.ok) throw new Error("Failed to fetch privacy settings");
      return res.json();
    },
    enabled: !!userId && isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const analyticsEnabled = useMemo(() => {
    if (!privacyData) return false; // privacy-safe default: don't track until known
    return privacyData.privacySettings?.analyticsTracking !== false;
  }, [privacyData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!analyticsEnabled) return;
    if (!location) return;

    // Avoid duplicate posts on re-renders.
    if (lastTrackedRef.current === location) return;
    lastTrackedRef.current = location;

    const sessionId = getOrCreateSessionId();
    void apiFetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "page_view",
        sessionId,
        page: location,
      }),
    }).catch(() => {});
  }, [analyticsEnabled, isAuthenticated, location]);

  return null;
}


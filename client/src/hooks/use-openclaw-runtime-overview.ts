import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface OpenClawRuntimeModuleStatus {
  skills: boolean;
  tools: boolean;
  gateway: boolean;
  plugins: boolean;
}

export interface OpenClawRuntimeOverview {
  generatedAt: string;
  health: {
    ok: boolean;
    modules: OpenClawRuntimeModuleStatus;
    warnings: string[];
  };
  controlPlane: {
    generatedAt: string;
    roles: Record<
      string,
      {
        role: string;
        lane: string;
        provider: string;
        target: string;
        purpose: string;
        configured: boolean;
        fallbacks: Array<{
          lane: string;
          provider: string;
          target: string;
          purpose: string;
          configured: boolean;
        }>;
      }
    >;
    capabilities: {
      backgroundTasks: boolean;
      persistentSubagents: boolean;
      browserAutomation: boolean;
      connectorStack: string[];
      longTermMemory: boolean;
      continuousSupervision: boolean;
    };
  };
  superAgent: {
    requestedOpenClawTag: string;
    localOpenClawVersion: string | null;
    connectors: {
      totalConnectors: number;
      totalCapabilities: number;
      coreConnectors: Array<{
        connectorId: string;
        displayName: string;
        category: string;
        authType: string;
        loaded: boolean;
        envReady: boolean;
        capabilityCount: number;
      }>;
    };
    ecosystem: {
      totalServices: number;
      enabledServices: number;
      featuredServices: Array<{
        id: string;
        enabled: boolean;
        reachable: boolean | null;
        status: number | null;
        role: string;
        baseUrl: string | null;
      }>;
    };
    capabilities: Record<string, boolean>;
  };
  background: {
    tasks: {
      started: boolean;
      cronEnabled: boolean;
      heartbeatsEnabled: boolean;
      jobs: number;
      pendingWakes: number;
      runningJobs: string[];
      startupError: string | null;
      heartbeat: {
        enabled: boolean;
        intervalMs: number | null;
        lastStatus: string;
        runCount: number;
        pendingWakeEvents: number;
      };
    };
    jobs: {
      jobs: Array<{
        id: string;
        name: string;
        enabled: boolean;
        schedule: {
          kind: string;
        };
        state?: {
          nextRunAtMs?: number | null;
        };
      }>;
      total: number;
    };
    runs: {
      entries: Array<{
        id?: string;
        jobId?: string;
        jobName?: string;
        status?: string;
        startedAtMs?: number;
        endedAtMs?: number;
      }>;
      total: number;
    };
    wakes: {
      count: number;
      events: Array<{
        id: string;
        mode: string;
        text: string;
        createdAtMs: number;
      }>;
    };
    processes: {
      count: number;
      running: number;
      recent: Array<{
        sessionId: string;
        status: string;
        command?: string;
        name?: string;
        runtimeMs?: number;
      }>;
    };
    extensions: {
      pluginsEnabled?: boolean;
      pluginCount?: number;
      hookCount?: number;
      workspaceDir?: string;
    };
    subagents: {
      totalRuns: number;
      activeRunners: number;
      counts: Record<string, number>;
    };
    sessions: {
      totalSessions: number;
      activeSessions: number;
      interruptedSessions: number;
      recoveryRequestedSessions: number;
      errorSessions: number;
    };
  };
  browser: {
    profiles: Array<{
      id: string;
      name: string;
      browserType: string;
      mobile: boolean;
    }>;
    activeSessions: number;
    counts: {
      browser: number;
      computerBrowser: number;
      computerDesktop: number;
    };
    capabilities: Record<string, boolean>;
    sessions: Array<{
      sessionId: string;
      controller: string;
      mode: string;
      profileId: string | null;
      objective: string | null;
      allowedDomains: string[];
      status: string;
      url: string | null;
      title: string | null;
      tabCount: number;
      updatedAtMs: number;
    }>;
  };
  connectors: {
    total: number;
    connected: number;
    enabledForUser: number;
    writeCapabilities: number;
    categories: Record<string, number>;
    items: Array<{
      connectorId: string;
      providerId: string;
      displayName: string;
      description: string;
      category: string;
      authType: string;
      connected: boolean;
      enabledForUser: boolean;
      capabilityCount: number;
      enabledCapabilityCount: number;
      writeCapabilityCount: number;
    }>;
  };
  orchestrator: {
    status: {
      storePath: string;
      runCount: number;
      lastRunAtMs: number | null;
    };
    recentRuns: Array<{
      runId: string;
      objective: string;
      status: string;
      success: boolean;
      completedTasks: number;
      failedTasks: number;
      executionTimeMs: number;
      completedAtMs?: number;
      createdAtMs: number;
    }>;
  };
}

export function useOpenClawRuntimeOverview(pollIntervalMs = 15_000) {
  const [overview, setOverview] = useState<OpenClawRuntimeOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview(showLoading: boolean) {
      if (showLoading) {
        setIsLoading(true);
      }

      try {
        const response = await apiFetch("/api/openclaw/runtime/overview", {
          timeoutMs: 10_000,
        });
        if (!response.ok) {
          throw new Error(`Runtime overview request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as OpenClawRuntimeOverview;
        if (cancelled) {
          return;
        }
        setOverview(payload);
        setError(null);
      } catch (cause) {
        if (cancelled) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "No se pudo cargar el runtime");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadOverview(true);
    const intervalId = window.setInterval(() => {
      void loadOverview(false);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pollIntervalMs, refreshKey]);

  return {
    overview,
    isLoading,
    error,
    refresh() {
      setRefreshKey((current) => current + 1);
    },
  };
}

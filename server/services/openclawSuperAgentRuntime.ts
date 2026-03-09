import fs from "node:fs";
import path from "node:path";
import {
  connectorRegistry,
  initializeConnectorManifests,
  type ConnectorManifest,
} from "../integrations/kernel";
import {
  agentEcosystemService,
  type AgentEcosystemServiceId,
} from "./agentEcosystemService";

const REQUESTED_OPENCLAW_TAG = "v2026.3.2";
const STATUS_CACHE_TTL_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

const CORE_CONNECTOR_IDS = [
  "gmail",
  "slack",
  "notion",
  "google-calendar",
  "outlook-calendar",
] as const;

const FEATURED_ECOSYSTEM_SERVICES = [
  "n8n",
  "qdrant",
  "searxng",
  "langfuse",
  "flowise",
  "open_webui",
  "browser_use",
] as const satisfies readonly AgentEcosystemServiceId[];

type CoreConnectorId = (typeof CORE_CONNECTOR_IDS)[number];

type EcosystemConfiguredService = ReturnType<typeof agentEcosystemService.getConfiguredServices>[number];

export type OpenClawCoreConnectorSummary = {
  connectorId: CoreConnectorId;
  displayName: string;
  category: string;
  authType: string;
  loaded: boolean;
  envReady: boolean;
  requiredEnvVars: string[];
  capabilityCount: number;
};

export type OpenClawConnectorCatalogSummary = {
  totalConnectors: number;
  totalCapabilities: number;
  categoryCounts: Record<string, number>;
  featuredConnectors: string[];
  coreConnectors: OpenClawCoreConnectorSummary[];
};

export type OpenClawEcosystemServiceSummary = {
  id: AgentEcosystemServiceId;
  enabled: boolean;
  baseUrl: string | null;
  source: "env" | "default" | "none";
  role: string;
  reachable: boolean | null;
  status: number | null;
  error?: string;
};

export type OpenClawSuperAgentCapabilities = {
  workflowAutomation: boolean;
  vectorMemory: boolean;
  observability: boolean;
  metasearch: boolean;
  browserResearch: boolean;
  connectorCatalog: boolean;
  multiAppAutomation: boolean;
};

export type OpenClawSuperAgentStatus = {
  requestedOpenClawTag: string;
  localOpenClawVersion: string | null;
  connectors: OpenClawConnectorCatalogSummary;
  ecosystem: {
    totalServices: number;
    enabledServices: number;
    featuredServices: OpenClawEcosystemServiceSummary[];
  };
  capabilities: OpenClawSuperAgentCapabilities;
};

type OpenClawSuperAgentStatusOptions = {
  includeProbes?: boolean;
  probeTimeoutMs?: number;
};

type OpenClawSuperAgentRuntimeDeps = {
  connectorRegistry?: Pick<typeof connectorRegistry, "size" | "listEnabled">;
  initializeConnectorManifests?: typeof initializeConnectorManifests;
  getConfiguredServices?: () => EcosystemConfiguredService[];
  probeService?: (
    serviceId: AgentEcosystemServiceId,
    timeoutMs?: number,
  ) => Promise<{ ok: boolean; status: number | null; error?: string }>;
  env?: NodeJS.ProcessEnv;
  nowMs?: () => number;
  openClawPackagePath?: string;
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function readOpenClawVersion(packagePath: string): string | null {
  try {
    const raw = fs.readFileSync(packagePath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim().length > 0
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function countByCategory(manifests: readonly ConnectorManifest[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const manifest of manifests) {
    const key = String(manifest.category || "general");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeConnectorManifest(
  manifests: readonly ConnectorManifest[],
  connectorId: CoreConnectorId,
): ConnectorManifest | undefined {
  return manifests.find((manifest) => manifest.connectorId === connectorId);
}

function coreConnectorEnvReady(connectorId: CoreConnectorId, manifest: ConnectorManifest | undefined, env: NodeJS.ProcessEnv): boolean {
  const required = manifest?.requiredEnvVars ?? [];
  if (required.length > 0 && required.every((envKey) => hasValue(env[envKey]))) {
    return true;
  }

  switch (connectorId) {
    case "gmail":
      return (
        (hasValue(env.GOOGLE_CLIENT_ID) && hasValue(env.GOOGLE_CLIENT_SECRET)) ||
        (hasValue(env.GMAIL_CLIENT_ID) && hasValue(env.GMAIL_CLIENT_SECRET)) ||
        hasValue(env.GMAIL_REFRESH_TOKEN)
      );
    case "slack":
      return (
        (hasValue(env.SLACK_CLIENT_ID) && hasValue(env.SLACK_CLIENT_SECRET)) ||
        hasValue(env.SLACK_BOT_TOKEN) ||
        hasValue(env.SLACK_WEBHOOK_URL)
      );
    case "notion":
      return (
        (hasValue(env.NOTION_CLIENT_ID) && hasValue(env.NOTION_CLIENT_SECRET)) ||
        hasValue(env.NOTION_API_KEY) ||
        hasValue(env.NOTION_TOKEN) ||
        hasValue(env.NOTION_INTERNAL_INTEGRATION_TOKEN)
      );
    case "google-calendar":
      return (
        (hasValue(env.GOOGLE_CLIENT_ID) && hasValue(env.GOOGLE_CLIENT_SECRET)) ||
        (hasValue(env.GOOGLE_CALENDAR_CLIENT_ID) &&
          hasValue(env.GOOGLE_CALENDAR_CLIENT_SECRET)) ||
        hasValue(env.GOOGLE_CALENDAR_ID)
      );
    case "outlook-calendar":
      return (
        (hasValue(env.OUTLOOK_CALENDAR_CLIENT_ID) &&
          hasValue(env.OUTLOOK_CALENDAR_CLIENT_SECRET)) ||
        (hasValue(env.MICROSOFT_CLIENT_ID) && hasValue(env.MICROSOFT_CLIENT_SECRET))
      );
  }
}

function ecosystemRole(serviceId: AgentEcosystemServiceId): string {
  switch (serviceId) {
    case "n8n":
      return "workflow automation";
    case "qdrant":
      return "vector memory";
    case "searxng":
      return "metasearch";
    case "langfuse":
      return "observability";
    case "flowise":
      return "agent workflow builder";
    case "open_webui":
      return "operator UI";
    case "browser_use":
      return "browser research";
    default:
      return "agent ecosystem";
  }
}

export class OpenClawSuperAgentRuntime {
  private readonly connectorRegistryImpl: Pick<typeof connectorRegistry, "size" | "listEnabled">;
  private readonly initializeConnectorManifestsImpl: typeof initializeConnectorManifests;
  private readonly getConfiguredServicesImpl: () => EcosystemConfiguredService[];
  private readonly probeServiceImpl: OpenClawSuperAgentRuntimeDeps["probeService"];
  private readonly env: NodeJS.ProcessEnv;
  private readonly nowMs: () => number;
  private readonly openClawPackagePath: string;
  private cachedStatus: { key: string; value: OpenClawSuperAgentStatus; createdAtMs: number } | null =
    null;

  constructor(deps: OpenClawSuperAgentRuntimeDeps = {}) {
    this.connectorRegistryImpl = deps.connectorRegistry ?? connectorRegistry;
    this.initializeConnectorManifestsImpl =
      deps.initializeConnectorManifests ?? initializeConnectorManifests;
    this.getConfiguredServicesImpl =
      deps.getConfiguredServices ?? (() => agentEcosystemService.getConfiguredServices());
    this.probeServiceImpl =
      deps.probeService ??
      ((serviceId, timeoutMs) => agentEcosystemService.probeService(serviceId, timeoutMs));
    this.env = deps.env ?? process.env;
    this.nowMs = deps.nowMs ?? Date.now;
    this.openClawPackagePath =
      deps.openClawPackagePath ??
      path.resolve(process.cwd(), "server", "openclaw", "package.json");
  }

  private async ensureConnectorCatalogLoaded() {
    if (this.connectorRegistryImpl.size > 0) {
      return;
    }
    await this.initializeConnectorManifestsImpl();
  }

  private buildConnectorSummary(manifests: readonly ConnectorManifest[]): OpenClawConnectorCatalogSummary {
    return {
      totalConnectors: manifests.length,
      totalCapabilities: manifests.reduce(
        (total, manifest) => total + manifest.capabilities.length,
        0,
      ),
      categoryCounts: countByCategory(manifests),
      featuredConnectors: manifests
        .map((manifest) => manifest.displayName)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 12),
      coreConnectors: CORE_CONNECTOR_IDS.map((connectorId) => {
        const manifest = normalizeConnectorManifest(manifests, connectorId);
        return {
          connectorId,
          displayName: manifest?.displayName ?? connectorId,
          category: String(manifest?.category ?? "general"),
          authType: String(manifest?.authType ?? "unknown"),
          loaded: Boolean(manifest),
          envReady: coreConnectorEnvReady(connectorId, manifest, this.env),
          requiredEnvVars: manifest?.requiredEnvVars ?? [],
          capabilityCount: manifest?.capabilities.length ?? 0,
        };
      }),
    };
  }

  private async buildEcosystemSummary(
    options: Required<Pick<OpenClawSuperAgentStatusOptions, "includeProbes" | "probeTimeoutMs">>,
  ) {
    const configuredServices = this.getConfiguredServicesImpl();
    const featuredServices = await Promise.all(
      FEATURED_ECOSYSTEM_SERVICES.map(async (serviceId) => {
        const configured = configuredServices.find((service) => service.id === serviceId) ?? {
          id: serviceId,
          enabled: false,
          baseUrl: null,
          source: "none" as const,
        };
        const probe =
          options.includeProbes && configured.enabled && configured.baseUrl && this.probeServiceImpl
            ? await this.probeServiceImpl(serviceId, options.probeTimeoutMs)
            : null;
        return {
          id: serviceId,
          enabled: configured.enabled,
          baseUrl: configured.baseUrl,
          source: configured.source,
          role: ecosystemRole(serviceId),
          reachable: probe ? probe.ok : null,
          status: probe?.status ?? null,
          error: probe?.error,
        } satisfies OpenClawEcosystemServiceSummary;
      }),
    );

    return {
      totalServices: configuredServices.length,
      enabledServices: configuredServices.filter((service) => service.enabled).length,
      featuredServices,
    };
  }

  private buildCapabilitySummary(
    connectors: OpenClawConnectorCatalogSummary,
    ecosystem: Awaited<ReturnType<OpenClawSuperAgentRuntime["buildEcosystemSummary"]>>,
  ): OpenClawSuperAgentCapabilities {
    const ecosystemById = new Map(ecosystem.featuredServices.map((service) => [service.id, service]));
    const coreConfiguredCount = connectors.coreConnectors.filter((connector) => connector.envReady).length;

    return {
      workflowAutomation: Boolean(ecosystemById.get("n8n")?.enabled),
      vectorMemory: Boolean(ecosystemById.get("qdrant")?.enabled),
      observability: Boolean(ecosystemById.get("langfuse")?.enabled),
      metasearch: Boolean(ecosystemById.get("searxng")?.enabled),
      browserResearch: Boolean(
        ecosystemById.get("browser_use")?.enabled || ecosystemById.get("open_webui")?.enabled,
      ),
      connectorCatalog: connectors.totalConnectors > 0,
      multiAppAutomation:
        coreConfiguredCount >= 2 || Boolean(ecosystemById.get("n8n")?.enabled),
    };
  }

  async getStatus(options: OpenClawSuperAgentStatusOptions = {}): Promise<OpenClawSuperAgentStatus> {
    const includeProbes = options.includeProbes ?? false;
    const probeTimeoutMs = Math.max(250, options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
    const cacheKey = `${includeProbes}:${probeTimeoutMs}`;
    const nowMs = this.nowMs();

    if (
      this.cachedStatus &&
      this.cachedStatus.key === cacheKey &&
      nowMs - this.cachedStatus.createdAtMs < STATUS_CACHE_TTL_MS
    ) {
      return this.cachedStatus.value;
    }

    await this.ensureConnectorCatalogLoaded();
    const manifests = this.connectorRegistryImpl.listEnabled();
    const connectors = this.buildConnectorSummary(manifests);
    const ecosystem = await this.buildEcosystemSummary({ includeProbes, probeTimeoutMs });
    const value: OpenClawSuperAgentStatus = {
      requestedOpenClawTag: REQUESTED_OPENCLAW_TAG,
      localOpenClawVersion: readOpenClawVersion(this.openClawPackagePath),
      connectors,
      ecosystem,
      capabilities: this.buildCapabilitySummary(connectors, ecosystem),
    };

    this.cachedStatus = {
      key: cacheKey,
      value,
      createdAtMs: nowMs,
    };

    return value;
  }
}

export const openClawSuperAgentRuntime = new OpenClawSuperAgentRuntime();

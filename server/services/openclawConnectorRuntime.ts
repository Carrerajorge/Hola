import { randomUUID } from "node:crypto";
import type { IntegrationPolicy } from "@shared/schema";
import {
  connectorExecutor,
  connectorRegistry,
  credentialVault,
  initializeConnectorManifests,
  type ConnectorCapability,
  type ConnectorManifest,
  type ConnectorOperationResult,
} from "../integrations/kernel";
import { getIntegrationPolicyCached } from "./integrationPolicyCache";

type ConnectorRegistryLike = Pick<typeof connectorRegistry, "get" | "listEnabled">;
type ConnectorExecutorLike = Pick<typeof connectorExecutor, "execute">;
type CredentialVaultLike = Pick<typeof credentialVault, "hasCredential">;

export type OpenClawConnectorDisabledReason =
  | "connector_not_enabled"
  | "tool_not_enabled"
  | "tool_disabled"
  | null;

export type OpenClawConnectorCatalogEntry = {
  connectorId: string;
  providerId: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  authType: string;
  connected: boolean;
  enabledForUser: boolean;
  disabledReason: OpenClawConnectorDisabledReason;
  capabilityCount: number;
  enabledCapabilityCount: number;
  writeCapabilityCount: number;
};

export type OpenClawConnectorCapabilitySummary = {
  operationId: string;
  name: string;
  description: string;
  requiredScopes: string[];
  dataAccessLevel: ConnectorCapability["dataAccessLevel"];
  confirmationRequired: boolean;
  enabledForUser: boolean;
  disabledReason: OpenClawConnectorDisabledReason;
  tags: string[];
  inputSchema: ConnectorCapability["inputSchema"];
  outputSchema: ConnectorCapability["outputSchema"];
};

export type OpenClawConnectorDetail = OpenClawConnectorCatalogEntry & {
  baseUrl: string | null;
  requiredEnvVars: string[];
  capabilities: OpenClawConnectorCapabilitySummary[];
};

export type OpenClawConnectorExecutionResponse = {
  connectorId: string;
  operationId: string;
  runId: string;
  chatId: string;
  confirmed: boolean;
  capability: Pick<
    OpenClawConnectorCapabilitySummary,
    "operationId" | "name" | "description" | "dataAccessLevel" | "confirmationRequired"
  >;
  success: boolean;
  data?: unknown;
  error?: ConnectorOperationResult["error"];
  metadata?: ConnectorOperationResult["metadata"];
};

type ExecuteOpenClawConnectorOperationParams = {
  userId: string;
  connectorId: string;
  operationId: string;
  input: Record<string, unknown>;
  chatId?: string;
  runId?: string;
  confirmed?: boolean;
};

type OpenClawConnectorRuntimeDeps = {
  connectorRegistry?: ConnectorRegistryLike;
  connectorExecutor?: ConnectorExecutorLike;
  credentialVault?: CredentialVaultLike;
  initializeConnectorManifests?: typeof initializeConnectorManifests;
  getIntegrationPolicy?: (userId: string) => Promise<IntegrationPolicy | null>;
  createRunId?: () => string;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function resolveProviderId(manifest: ConnectorManifest): string {
  return manifest.providerId || manifest.connectorId;
}

function isConnectorEnabledForUser(
  manifest: ConnectorManifest,
  policy: IntegrationPolicy | null,
): boolean {
  const enabledApps = normalizeStringArray(policy?.enabledApps);
  return enabledApps.length === 0 || enabledApps.includes(manifest.connectorId);
}

function resolveCapabilityAccess(
  manifest: ConnectorManifest,
  capability: ConnectorCapability,
  policy: IntegrationPolicy | null,
): { enabled: boolean; disabledReason: OpenClawConnectorDisabledReason } {
  if (!isConnectorEnabledForUser(manifest, policy)) {
    return { enabled: false, disabledReason: "connector_not_enabled" };
  }

  const disabledTools = new Set(normalizeStringArray(policy?.disabledTools));
  if (disabledTools.has(capability.operationId)) {
    return { enabled: false, disabledReason: "tool_disabled" };
  }

  const enabledTools = normalizeStringArray(policy?.enabledTools);
  if (enabledTools.length > 0 && !enabledTools.includes(capability.operationId)) {
    return { enabled: false, disabledReason: "tool_not_enabled" };
  }

  return { enabled: true, disabledReason: null };
}

function buildCapabilitySummary(
  manifest: ConnectorManifest,
  capability: ConnectorCapability,
  policy: IntegrationPolicy | null,
): OpenClawConnectorCapabilitySummary {
  const access = resolveCapabilityAccess(manifest, capability, policy);
  return {
    operationId: capability.operationId,
    name: capability.name,
    description: capability.description,
    requiredScopes: capability.requiredScopes,
    dataAccessLevel: capability.dataAccessLevel,
    confirmationRequired: capability.confirmationRequired,
    enabledForUser: access.enabled,
    disabledReason: access.disabledReason,
    tags: capability.tags || [],
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
  };
}

function buildCatalogEntry(
  manifest: ConnectorManifest,
  policy: IntegrationPolicy | null,
  connected: boolean,
): OpenClawConnectorCatalogEntry {
  const capabilities = manifest.capabilities.map((capability) =>
    buildCapabilitySummary(manifest, capability, policy),
  );
  const connectorEnabled = isConnectorEnabledForUser(manifest, policy);

  return {
    connectorId: manifest.connectorId,
    providerId: resolveProviderId(manifest),
    displayName: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    category: manifest.category,
    authType: manifest.authType,
    connected,
    enabledForUser: connectorEnabled,
    disabledReason: connectorEnabled ? null : "connector_not_enabled",
    capabilityCount: capabilities.length,
    enabledCapabilityCount: capabilities.filter((capability) => capability.enabledForUser).length,
    writeCapabilityCount: capabilities.filter(
      (capability) =>
        capability.dataAccessLevel === "write" || capability.dataAccessLevel === "admin",
    ).length,
  };
}

export function mapConnectorExecutionStatus(
  result: Pick<OpenClawConnectorExecutionResponse, "success" | "error">,
): number {
  if (result.success) return 200;

  switch (result.error?.code) {
    case "CONNECTOR_NOT_FOUND":
    case "OPERATION_NOT_FOUND":
      return 404;
    case "CONNECTOR_DISABLED_BY_POLICY":
    case "OPERATION_DISABLED_BY_POLICY":
    case "INSUFFICIENT_SCOPES":
      return 403;
    case "REQUIRES_CONFIRMATION":
    case "NO_CREDENTIAL":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "CIRCUIT_OPEN":
      return 503;
    default:
      return 502;
  }
}

export class OpenClawConnectorRuntime {
  private readonly connectorRegistryImpl: ConnectorRegistryLike;
  private readonly connectorExecutorImpl: ConnectorExecutorLike;
  private readonly credentialVaultImpl: CredentialVaultLike;
  private readonly initializeConnectorManifestsImpl: typeof initializeConnectorManifests;
  private readonly getIntegrationPolicyImpl: (userId: string) => Promise<IntegrationPolicy | null>;
  private readonly createRunIdImpl: () => string;

  constructor(deps: OpenClawConnectorRuntimeDeps = {}) {
    this.connectorRegistryImpl = deps.connectorRegistry ?? connectorRegistry;
    this.connectorExecutorImpl = deps.connectorExecutor ?? connectorExecutor;
    this.credentialVaultImpl = deps.credentialVault ?? credentialVault;
    this.initializeConnectorManifestsImpl =
      deps.initializeConnectorManifests ?? initializeConnectorManifests;
    this.getIntegrationPolicyImpl = deps.getIntegrationPolicy ?? getIntegrationPolicyCached;
    this.createRunIdImpl = deps.createRunId ?? (() => `ocl_rt_${randomUUID()}`);
  }

  async listCatalog(userId: string): Promise<OpenClawConnectorCatalogEntry[]> {
    await this.initializeConnectorManifestsImpl();

    const manifests = this.connectorRegistryImpl
      .listEnabled()
      .slice()
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    const policy = await this.getIntegrationPolicyImpl(userId);
    const providerConnectivity = await this.buildProviderConnectivity(userId, manifests);

    return manifests.map((manifest) =>
      buildCatalogEntry(
        manifest,
        policy,
        manifest.authType === "none" || providerConnectivity.get(resolveProviderId(manifest)) === true,
      ),
    );
  }

  async getConnector(
    userId: string,
    connectorId: string,
  ): Promise<OpenClawConnectorDetail | null> {
    await this.initializeConnectorManifestsImpl();

    const manifest = this.connectorRegistryImpl.get(connectorId);
    if (!manifest) {
      return null;
    }

    const policy = await this.getIntegrationPolicyImpl(userId);
    const connected =
      manifest.authType === "none" ||
      (await this.hasCredential(userId, resolveProviderId(manifest)));

    return {
      ...buildCatalogEntry(manifest, policy, connected),
      baseUrl: manifest.baseUrl ?? null,
      requiredEnvVars: manifest.requiredEnvVars || [],
      capabilities: manifest.capabilities.map((capability) =>
        buildCapabilitySummary(manifest, capability, policy),
      ),
    };
  }

  async executeOperation(
    params: ExecuteOpenClawConnectorOperationParams,
  ): Promise<OpenClawConnectorExecutionResponse> {
    await this.initializeConnectorManifestsImpl();

    const manifest = this.connectorRegistryImpl.get(params.connectorId);
    const runId = params.runId?.trim() || this.createRunIdImpl();
    const chatId = params.chatId?.trim() || `openclaw-runtime:${params.connectorId}`;
    const confirmed = params.confirmed === true;

    if (!manifest) {
      return {
        connectorId: params.connectorId,
        operationId: params.operationId,
        runId,
        chatId,
        confirmed,
        capability: {
          operationId: params.operationId,
          name: params.operationId,
          description: "",
          dataAccessLevel: "read",
          confirmationRequired: false,
        },
        success: false,
        error: {
          code: "CONNECTOR_NOT_FOUND",
          message: `Connector "${params.connectorId}" not registered`,
          retryable: false,
        },
      };
    }

    const capability = manifest.capabilities.find(
      (entry) => entry.operationId === params.operationId,
    );
    if (!capability) {
      return {
        connectorId: manifest.connectorId,
        operationId: params.operationId,
        runId,
        chatId,
        confirmed,
        capability: {
          operationId: params.operationId,
          name: params.operationId,
          description: "",
          dataAccessLevel: "read",
          confirmationRequired: false,
        },
        success: false,
        error: {
          code: "OPERATION_NOT_FOUND",
          message: `Operation "${params.operationId}" not found in connector "${params.connectorId}"`,
          retryable: false,
        },
      };
    }

    const policy = await this.getIntegrationPolicyImpl(params.userId);
    if (!isConnectorEnabledForUser(manifest, policy)) {
      return {
        connectorId: manifest.connectorId,
        operationId: capability.operationId,
        runId,
        chatId,
        confirmed,
        capability: {
          operationId: capability.operationId,
          name: capability.name,
          description: capability.description,
          dataAccessLevel: capability.dataAccessLevel,
          confirmationRequired: capability.confirmationRequired,
        },
        success: false,
        error: {
          code: "CONNECTOR_DISABLED_BY_POLICY",
          message: `Connector "${manifest.connectorId}" is disabled for this user`,
          retryable: false,
        },
      };
    }

    const capabilityAccess = resolveCapabilityAccess(manifest, capability, policy);
    if (!capabilityAccess.enabled) {
      return {
        connectorId: manifest.connectorId,
        operationId: capability.operationId,
        runId,
        chatId,
        confirmed,
        capability: {
          operationId: capability.operationId,
          name: capability.name,
          description: capability.description,
          dataAccessLevel: capability.dataAccessLevel,
          confirmationRequired: capability.confirmationRequired,
        },
        success: false,
        error: {
          code: "OPERATION_DISABLED_BY_POLICY",
          message: `Operation "${capability.operationId}" is disabled for this user`,
          retryable: false,
          details: { disabledReason: capabilityAccess.disabledReason },
        },
      };
    }

    if (capability.confirmationRequired && !confirmed) {
      return {
        connectorId: manifest.connectorId,
        operationId: capability.operationId,
        runId,
        chatId,
        confirmed,
        capability: {
          operationId: capability.operationId,
          name: capability.name,
          description: capability.description,
          dataAccessLevel: capability.dataAccessLevel,
          confirmationRequired: capability.confirmationRequired,
        },
        success: false,
        error: {
          code: "REQUIRES_CONFIRMATION",
          message: `Operation "${capability.name}" requires confirmation before execution.`,
          retryable: false,
        },
      };
    }

    const result = await this.connectorExecutorImpl.execute(
      manifest.connectorId,
      capability.operationId,
      params.input,
      {
        userId: params.userId,
        chatId,
        runId,
        isConfirmed: confirmed,
      },
    );

    return {
      connectorId: manifest.connectorId,
      operationId: capability.operationId,
      runId,
      chatId,
      confirmed,
      capability: {
        operationId: capability.operationId,
        name: capability.name,
        description: capability.description,
        dataAccessLevel: capability.dataAccessLevel,
        confirmationRequired: capability.confirmationRequired,
      },
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: result.metadata,
    };
  }

  private async buildProviderConnectivity(
    userId: string,
    manifests: readonly ConnectorManifest[],
  ): Promise<Map<string, boolean>> {
    const providerIds = [...new Set(manifests.map((manifest) => resolveProviderId(manifest)))];
    const connectivity = await Promise.all(
      providerIds.map(async (providerId) => [providerId, await this.hasCredential(userId, providerId)]),
    );
    return new Map(connectivity);
  }

  private async hasCredential(userId: string, providerId: string): Promise<boolean> {
    try {
      return await this.credentialVaultImpl.hasCredential(userId, providerId);
    } catch {
      return false;
    }
  }
}

export const openClawConnectorRuntime = new OpenClawConnectorRuntime();

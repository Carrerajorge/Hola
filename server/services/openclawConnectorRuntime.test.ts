import { describe, expect, it, vi } from "vitest";
import {
  OpenClawConnectorRuntime,
  mapConnectorExecutionStatus,
} from "./openclawConnectorRuntime";
import type { ConnectorCapability, ConnectorManifest } from "../integrations/kernel";

function createCapability(params: {
  operationId: string;
  name: string;
  dataAccessLevel?: ConnectorCapability["dataAccessLevel"];
  confirmationRequired?: boolean;
  requiredScopes?: string[];
  tags?: string[];
}): ConnectorCapability {
  return {
    operationId: params.operationId,
    name: params.name,
    description: `${params.name} description`,
    requiredScopes: params.requiredScopes ?? [],
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {},
    },
    dataAccessLevel: params.dataAccessLevel ?? "read",
    confirmationRequired: params.confirmationRequired ?? false,
    idempotent: params.dataAccessLevel !== "write",
    tags: params.tags ?? [],
  };
}

function createManifest(params: {
  connectorId: string;
  displayName: string;
  category: string;
  authType?: string;
  providerId?: string;
  capabilities: ConnectorCapability[];
}): ConnectorManifest {
  return {
    connectorId: params.connectorId,
    version: "1.0.0",
    displayName: params.displayName,
    description: `${params.displayName} connector`,
    iconUrl: `/icons/${params.connectorId}.svg`,
    category: params.category as ConnectorManifest["category"],
    authType: (params.authType ?? "oauth2") as ConnectorManifest["authType"],
    authConfig: {},
    providerId: params.providerId,
    capabilities: params.capabilities,
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
    },
    requiredEnvVars: [],
  };
}

describe("OpenClawConnectorRuntime", () => {
  it("lists connector catalog with user policy and deduplicated provider connectivity", async () => {
    const manifests = [
      createManifest({
        connectorId: "gmail",
        displayName: "Gmail",
        category: "email",
        providerId: "google",
        capabilities: [
          createCapability({ operationId: "gmail_search", name: "Search emails" }),
        ],
      }),
      createManifest({
        connectorId: "google-calendar",
        displayName: "Google Calendar",
        category: "productivity",
        providerId: "google",
        capabilities: [
          createCapability({
            operationId: "google_calendar_list_events",
            name: "List events",
          }),
          createCapability({
            operationId: "google_calendar_create_event",
            name: "Create event",
            dataAccessLevel: "write",
            confirmationRequired: true,
          }),
        ],
      }),
      createManifest({
        connectorId: "slack",
        displayName: "Slack",
        category: "comms",
        capabilities: [
          createCapability({
            operationId: "slack_post_message",
            name: "Post message",
            dataAccessLevel: "write",
            confirmationRequired: true,
          }),
        ],
      }),
    ];

    const hasCredential = vi.fn(async (_userId: string, providerId: string) => providerId === "google");
    const runtime = new OpenClawConnectorRuntime({
      connectorRegistry: {
        get: (connectorId) => manifests.find((manifest) => manifest.connectorId === connectorId),
        listEnabled: () => manifests,
      },
      connectorExecutor: {
        execute: vi.fn(),
      },
      credentialVault: {
        hasCredential,
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getIntegrationPolicy: vi.fn(async () => ({
        id: "policy_1",
        userId: "user_test",
        enabledApps: ["gmail", "google-calendar"],
        enabledTools: [],
        disabledTools: ["google_calendar_create_event"],
        resourceScopes: null,
        autoConfirmPolicy: "ask",
        sandboxMode: "false",
        maxParallelCalls: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      createRunId: () => "ocl_rt_fixed",
    });

    const connectors = await runtime.listCatalog("user_test");

    expect(connectors.map((connector) => connector.connectorId)).toEqual([
      "gmail",
      "google-calendar",
      "slack",
    ]);
    expect(connectors.find((connector) => connector.connectorId === "gmail")).toMatchObject({
      connected: true,
      enabledForUser: true,
      enabledCapabilityCount: 1,
    });
    expect(
      connectors.find((connector) => connector.connectorId === "google-calendar"),
    ).toMatchObject({
      connected: true,
      enabledForUser: true,
      capabilityCount: 2,
      enabledCapabilityCount: 1,
      writeCapabilityCount: 1,
    });
    expect(connectors.find((connector) => connector.connectorId === "slack")).toMatchObject({
      connected: false,
      enabledForUser: false,
      disabledReason: "connector_not_enabled",
    });
    expect(hasCredential).toHaveBeenCalledTimes(2);
    expect(hasCredential).toHaveBeenCalledWith("user_test", "google");
    expect(hasCredential).toHaveBeenCalledWith("user_test", "slack");
  });

  it("returns connector detail with per-capability policy visibility", async () => {
    const manifests = [
      createManifest({
        connectorId: "notion",
        displayName: "Notion",
        category: "productivity",
        capabilities: [
          createCapability({
            operationId: "notion_search",
            name: "Search pages",
          }),
          createCapability({
            operationId: "notion_create_page",
            name: "Create page",
            dataAccessLevel: "write",
            confirmationRequired: true,
          }),
        ],
      }),
    ];

    const runtime = new OpenClawConnectorRuntime({
      connectorRegistry: {
        get: (connectorId) => manifests.find((manifest) => manifest.connectorId === connectorId),
        listEnabled: () => manifests,
      },
      connectorExecutor: {
        execute: vi.fn(),
      },
      credentialVault: {
        hasCredential: vi.fn(async () => false),
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getIntegrationPolicy: vi.fn(async () => ({
        id: "policy_2",
        userId: "user_test",
        enabledApps: ["notion"],
        enabledTools: ["notion_search"],
        disabledTools: [],
        resourceScopes: null,
        autoConfirmPolicy: "ask",
        sandboxMode: "false",
        maxParallelCalls: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });

    const connector = await runtime.getConnector("user_test", "notion");

    expect(connector).not.toBeNull();
    expect(connector).toMatchObject({
      connectorId: "notion",
      connected: false,
      enabledForUser: true,
    });
    expect(connector?.capabilities).toEqual([
      expect.objectContaining({
        operationId: "notion_search",
        enabledForUser: true,
        disabledReason: null,
      }),
      expect.objectContaining({
        operationId: "notion_create_page",
        enabledForUser: false,
        disabledReason: "tool_not_enabled",
        confirmationRequired: true,
      }),
    ]);
  });

  it("blocks write operations that require confirmation before touching the executor", async () => {
    const execute = vi.fn(async () => ({
      success: true,
      data: { ok: true },
    }));
    const manifest = createManifest({
      connectorId: "slack",
      displayName: "Slack",
      category: "comms",
      capabilities: [
        createCapability({
          operationId: "slack_post_message",
          name: "Post message",
          dataAccessLevel: "write",
          confirmationRequired: true,
        }),
      ],
    });
    const runtime = new OpenClawConnectorRuntime({
      connectorRegistry: {
        get: (connectorId) => (connectorId === "slack" ? manifest : undefined),
        listEnabled: () => [manifest],
      },
      connectorExecutor: {
        execute,
      },
      credentialVault: {
        hasCredential: vi.fn(async () => true),
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getIntegrationPolicy: vi.fn(async () => null),
      createRunId: () => "ocl_rt_fixed",
    });

    const blocked = await runtime.executeOperation({
      userId: "user_test",
      connectorId: "slack",
      operationId: "slack_post_message",
      input: { channel: "C1", text: "hola" },
      confirmed: false,
    });

    expect(blocked.success).toBe(false);
    expect(blocked.error?.code).toBe("REQUIRES_CONFIRMATION");
    expect(execute).not.toHaveBeenCalled();
    expect(mapConnectorExecutionStatus(blocked)).toBe(409);
  });

  it("executes allowed operations with stable runtime context", async () => {
    const execute = vi.fn(async () => ({
      success: true,
      data: { delivered: true },
      metadata: { requestId: "req_1", latencyMs: 42 },
    }));
    const manifest = createManifest({
      connectorId: "gmail",
      displayName: "Gmail",
      category: "email",
      providerId: "google",
      capabilities: [
        createCapability({
          operationId: "gmail_search",
          name: "Search emails",
        }),
      ],
    });
    const runtime = new OpenClawConnectorRuntime({
      connectorRegistry: {
        get: (connectorId) => (connectorId === "gmail" ? manifest : undefined),
        listEnabled: () => [manifest],
      },
      connectorExecutor: {
        execute,
      },
      credentialVault: {
        hasCredential: vi.fn(async () => true),
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getIntegrationPolicy: vi.fn(async () => null),
      createRunId: () => "ocl_rt_fixed",
    });

    const result = await runtime.executeOperation({
      userId: "user_test",
      connectorId: "gmail",
      operationId: "gmail_search",
      input: { q: "from:team@example.com" },
      confirmed: false,
    });

    expect(result).toMatchObject({
      connectorId: "gmail",
      operationId: "gmail_search",
      runId: "ocl_rt_fixed",
      chatId: "openclaw-runtime:gmail",
      success: true,
      data: { delivered: true },
    });
    expect(execute).toHaveBeenCalledWith(
      "gmail",
      "gmail_search",
      { q: "from:team@example.com" },
      {
        userId: "user_test",
        chatId: "openclaw-runtime:gmail",
        runId: "ocl_rt_fixed",
        isConfirmed: false,
      },
    );
    expect(mapConnectorExecutionStatus(result)).toBe(200);
  });
});

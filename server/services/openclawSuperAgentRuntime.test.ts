import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenClawSuperAgentRuntime } from "./openclawSuperAgentRuntime";
import type { ConnectorManifest } from "../integrations/kernel";

function createManifest(params: {
  connectorId: string;
  displayName: string;
  category: string;
  authType?: string;
  requiredEnvVars?: string[];
  capabilityCount?: number;
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
    capabilities: Array.from({ length: params.capabilityCount ?? 1 }, (_, index) => ({
      operationId: `${params.connectorId}_op_${index + 1}`,
      name: `${params.displayName} op ${index + 1}`,
      description: `${params.displayName} capability ${index + 1}`,
      requiredScopes: [],
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {},
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
    })),
    rateLimit: {
      requestsPerMinute: 60,
      requestsPerHour: 500,
    },
    requiredEnvVars: params.requiredEnvVars ?? [],
  };
}

describe("OpenClawSuperAgentRuntime", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aggregates connector catalog and env readiness without probing services", async () => {
    const manifests = [
      createManifest({
        connectorId: "gmail",
        displayName: "Gmail",
        category: "email",
        requiredEnvVars: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
        capabilityCount: 2,
      }),
      createManifest({
        connectorId: "slack",
        displayName: "Slack",
        category: "comms",
        requiredEnvVars: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
        capabilityCount: 4,
      }),
      createManifest({
        connectorId: "notion",
        displayName: "Notion",
        category: "productivity",
        capabilityCount: 3,
      }),
      createManifest({
        connectorId: "google-calendar",
        displayName: "Google Calendar",
        category: "productivity",
        capabilityCount: 2,
      }),
      createManifest({
        connectorId: "outlook-calendar",
        displayName: "Outlook Calendar",
        category: "productivity",
        capabilityCount: 2,
      }),
      createManifest({
        connectorId: "github",
        displayName: "GitHub",
        category: "dev",
        capabilityCount: 5,
      }),
    ];

    const probeService = vi.fn();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-superagent-"));
    tempDirs.push(tempDir);
    const packagePath = path.join(tempDir, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ version: "2026.2.25" }), "utf8");

    const runtime = new OpenClawSuperAgentRuntime({
      connectorRegistry: {
        size: manifests.length,
        listEnabled: () => manifests,
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getConfiguredServices: () => [
        { id: "n8n", enabled: true, baseUrl: "http://localhost:5678", source: "default" as const },
        { id: "qdrant", enabled: true, baseUrl: "http://localhost:6333", source: "default" as const },
        { id: "searxng", enabled: true, baseUrl: "http://localhost:8081", source: "default" as const },
        { id: "langfuse", enabled: false, baseUrl: null, source: "none" as const },
        { id: "flowise", enabled: true, baseUrl: "http://localhost:3001", source: "default" as const },
        { id: "open_webui", enabled: false, baseUrl: null, source: "none" as const },
        { id: "browser_use", enabled: false, baseUrl: null, source: "none" as const },
      ],
      probeService,
      env: {
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
        SLACK_BOT_TOKEN: "xoxb-test",
        NOTION_API_KEY: "notion-secret",
      },
      openClawPackagePath: packagePath,
    });

    const status = await runtime.getStatus({ includeProbes: false });

    expect(probeService).not.toHaveBeenCalled();
    expect(status.requestedOpenClawTag).toBe("v2026.3.2");
    expect(status.localOpenClawVersion).toBe("2026.2.25");
    expect(status.connectors.totalConnectors).toBe(6);
    expect(status.connectors.totalCapabilities).toBe(18);
    expect(status.connectors.categoryCounts).toEqual({
      comms: 1,
      dev: 1,
      email: 1,
      productivity: 3,
    });
    expect(
      status.connectors.coreConnectors.map((connector) => ({
        id: connector.connectorId,
        envReady: connector.envReady,
      })),
    ).toEqual([
      { id: "gmail", envReady: true },
      { id: "slack", envReady: true },
      { id: "notion", envReady: true },
      { id: "google-calendar", envReady: true },
      { id: "outlook-calendar", envReady: false },
    ]);
    expect(status.capabilities.workflowAutomation).toBe(true);
    expect(status.capabilities.vectorMemory).toBe(true);
    expect(status.capabilities.metasearch).toBe(true);
    expect(status.capabilities.connectorCatalog).toBe(true);
    expect(status.capabilities.multiAppAutomation).toBe(true);
  });

  it("includes ecosystem reachability when probes are requested", async () => {
    const manifests = [
      createManifest({
        connectorId: "gmail",
        displayName: "Gmail",
        category: "email",
      }),
    ];
    const probeService = vi.fn(async (serviceId: string) => {
      if (serviceId === "n8n") {
        return { ok: true, status: 200 };
      }
      return { ok: false, status: 503, error: "unreachable" };
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-superagent-"));
    tempDirs.push(tempDir);
    const packagePath = path.join(tempDir, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify({ version: "2026.3.1" }), "utf8");

    const runtime = new OpenClawSuperAgentRuntime({
      connectorRegistry: {
        size: manifests.length,
        listEnabled: () => manifests,
      },
      initializeConnectorManifests: vi.fn(async () => {}),
      getConfiguredServices: () => [
        { id: "n8n", enabled: true, baseUrl: "http://localhost:5678", source: "default" as const },
        { id: "qdrant", enabled: true, baseUrl: "http://localhost:6333", source: "default" as const },
        { id: "searxng", enabled: false, baseUrl: null, source: "none" as const },
        { id: "langfuse", enabled: false, baseUrl: null, source: "none" as const },
        { id: "flowise", enabled: false, baseUrl: null, source: "none" as const },
        { id: "open_webui", enabled: false, baseUrl: null, source: "none" as const },
        { id: "browser_use", enabled: false, baseUrl: null, source: "none" as const },
      ],
      probeService,
      env: {},
      openClawPackagePath: packagePath,
    });

    const status = await runtime.getStatus({ includeProbes: true, probeTimeoutMs: 900 });

    expect(probeService).toHaveBeenCalledWith("n8n", 900);
    expect(probeService).toHaveBeenCalledWith("qdrant", 900);
    expect(status.ecosystem.featuredServices.find((service) => service.id === "n8n")).toMatchObject(
      {
        reachable: true,
        status: 200,
      },
    );
    expect(
      status.ecosystem.featuredServices.find((service) => service.id === "qdrant"),
    ).toMatchObject({
      reachable: false,
      status: 503,
      error: "unreachable",
    });
  });
});

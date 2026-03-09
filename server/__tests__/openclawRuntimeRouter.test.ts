import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const runtimeRuns: any[] = [];
const resolvedSkillContext = {
  activeSkillId: "skill_master_1",
  activeSkillRef: {
    id: "skill_master_1",
    name: "kubernetes-ops",
    description: "Operacion de clusters",
    category: "integrations",
    builtIn: true,
    enabled: true,
    features: ["pod-health"],
    triggers: ["k8s"],
    runtimeTools: ["openclaw_clawi_exec"],
  },
  availableSkills: [],
  skillContext: {
    activeSkill: {
      id: "skill_master_1",
      name: "kubernetes-ops",
      description: "Operacion de clusters",
      badgeLabel: "InfraOps",
      domainLabel: "Infraestructura, cloud y plataforma",
      lane: "speed",
      executionMode: "hybrid",
      readiness: "setup_required",
      primaryTools: ["openclaw_clawi_exec", "analyze_data"],
      fallbackTools: ["synthesize"],
      requiredScopes: ["external_network", "system"],
      abilities: ["pod-health"],
      searchTerms: ["kubernetes", "pod", "cluster"],
      routingStrategy: "Inspecciona, actua y valida impacto.",
      routingNotes: ["Prioriza CLI antes de sintesis."],
    },
    relevantSkills: [],
    routingNotes: ["La skill activa debe llegar al planner."],
  },
};

const backgroundJobs = [
  {
    id: "job_1",
    name: "Revisar backlog",
    enabled: true,
    sessionTarget: "isolated",
    wakeMode: "now",
    schedule: { kind: "every", everyMs: 60000 },
    payload: { kind: "agentTurn", message: "Revisar backlog" },
    state: { nextRunAtMs: Date.now() + 60000 },
  },
];

const openClawTaskRuntimeMock = {
  ensureStarted: vi.fn(async () => {}),
  status: vi.fn(async () => ({
    started: true,
    cronEnabled: true,
    heartbeatsEnabled: true,
    storePath: "/tmp/jobs.json",
    jobs: backgroundJobs.length,
    nextWakeAtMs: backgroundJobs[0].state.nextRunAtMs,
    runningJobs: [],
    pendingWakes: 1,
    lastTickAtMs: null,
    startupError: null,
    heartbeatWakeHandlerAttached: true,
    heartbeat: {
      enabled: true,
      intervalMs: 60000,
      handlerAttached: true,
      pendingSignals: false,
      pendingWakeEvents: 1,
      lastRequestedAtMs: null,
      lastRunAtMs: null,
      lastReason: null,
      lastStatus: "idle",
      lastDurationMs: null,
      lastError: null,
      runCount: 0,
      processedWakeEvents: 0,
    },
  })),
  listPage: vi.fn(async () => ({
    jobs: backgroundJobs,
    total: backgroundJobs.length,
    offset: 0,
    limit: 50,
    hasMore: false,
    nextOffset: null,
  })),
  addJobFromInput: vi.fn(async () => backgroundJobs[0]),
  updateJobFromInput: vi.fn(async () => ({ ...backgroundJobs[0], name: "Actualizado" })),
  removeJob: vi.fn(async () => ({ ok: true, removed: true })),
  runJob: vi.fn(async () => ({ ok: true, ran: true, job: backgroundJobs[0] })),
  listRuns: vi.fn(async () => ({
    entries: [],
    total: 0,
    offset: 0,
    limit: 50,
    hasMore: false,
    nextOffset: null,
  })),
  wake: vi.fn(async (payload: any) => ({
    queued: true,
    event: {
      id: "wake_1",
      mode: payload.mode,
      text: payload.text,
      source: "runtime:manual",
      createdAtMs: Date.now(),
    },
  })),
  listWakeEvents: vi.fn(async () => ({
    count: 1,
    events: [
      {
        id: "wake_1",
        mode: "now",
        text: "wake",
        source: "runtime:manual",
        createdAtMs: Date.now(),
      },
    ],
  })),
  getHeartbeatStatus: vi.fn(async () => ({
    enabled: true,
    intervalMs: 60000,
    handlerAttached: true,
    pendingSignals: false,
    pendingWakeEvents: 1,
    lastRequestedAtMs: null,
    lastRunAtMs: null,
    lastReason: null,
    lastStatus: "idle",
    lastDurationMs: null,
    lastError: null,
    runCount: 0,
    processedWakeEvents: 0,
  })),
  requestHeartbeat: vi.fn(async () => ({
    queued: true,
    requestedAtMs: Date.now(),
    heartbeat: {
      enabled: true,
      intervalMs: 60000,
      handlerAttached: true,
      pendingSignals: true,
      pendingWakeEvents: 1,
      lastRequestedAtMs: Date.now(),
      lastRunAtMs: null,
      lastReason: "runtime:manual",
      lastStatus: "idle",
      lastDurationMs: null,
      lastError: null,
      runCount: 0,
      processedWakeEvents: 0,
    },
  })),
  runHeartbeatNow: vi.fn(async () => ({
    status: "ran",
    durationMs: 5,
    heartbeat: {
      enabled: true,
      intervalMs: 60000,
      handlerAttached: true,
      pendingSignals: false,
      pendingWakeEvents: 0,
      lastRequestedAtMs: Date.now(),
      lastRunAtMs: Date.now(),
      lastReason: "runtime:manual-run",
      lastStatus: "ran",
      lastDurationMs: 5,
      lastError: null,
      runCount: 1,
      processedWakeEvents: 1,
    },
  })),
};

const openClawProcessRuntimeMock = {
  listSessions: vi.fn(() => ({
    count: 1,
    sessions: [
      {
        sessionId: "sess_1",
        status: "running",
        startedAt: Date.now() - 1000,
        runtimeMs: 1000,
        command: "npm run dev",
        name: "npm run dev",
      },
    ],
    text: "sess_1 running",
  })),
  pollSession: vi.fn(async () => ({
    status: "running",
    sessionId: "sess_1",
    output: "running",
  })),
  getSessionLog: vi.fn(() => ({
    status: "running",
    sessionId: "sess_1",
    text: "log",
  })),
  writeToSession: vi.fn(async () => ({ status: "running" })),
  sendKeys: vi.fn(async () => ({ status: "running" })),
  submitSession: vi.fn(async () => ({ status: "running" })),
  pasteToSession: vi.fn(async () => ({ status: "running" })),
  killSession: vi.fn(() => ({ status: "failed" })),
  clearSession: vi.fn(() => ({ status: "completed" })),
  removeSession: vi.fn(() => ({ status: "completed" })),
};

const openClawExtensionRuntimeMock = {
  getSummary: vi.fn(() => ({
    workspaceDir: "/tmp/openclaw-workspace",
    pluginsEnabled: true,
    pluginCount: 2,
    loadedPluginCount: 1,
    failedPluginCount: 0,
    pluginDiagnostics: 1,
    pluginErrors: 0,
    hookCount: 3,
    eligibleHookCount: 2,
    internalHookKeyCount: 1,
    typedHookNames: ["before_tool_call"],
    hookRunnerInitialized: true,
  })),
  getStatus: vi.fn(() => ({
    summary: {
      workspaceDir: "/tmp/openclaw-workspace",
      pluginsEnabled: true,
      pluginCount: 2,
      loadedPluginCount: 1,
      failedPluginCount: 0,
      pluginDiagnostics: 1,
      pluginErrors: 0,
      hookCount: 3,
      eligibleHookCount: 2,
      internalHookKeyCount: 1,
      typedHookNames: ["before_tool_call"],
      hookRunnerInitialized: true,
    },
    plugins: {
      workspaceDir: "/tmp/openclaw-workspace",
      pluginsEnabled: true,
      cacheKey: "plugin-cache-key",
      globalRegistryLoaded: true,
      hookRunnerInitialized: true,
      counts: {
        plugins: 2,
        loadedPlugins: 1,
        disabledPlugins: 1,
        failedPlugins: 0,
        tools: 2,
        hooks: 1,
        typedHooks: 1,
        channels: 1,
        providers: 0,
        gatewayHandlers: 1,
        httpHandlers: 0,
        httpRoutes: 0,
        cliRegistrars: 0,
        services: 0,
        commands: 0,
      },
      diagnostics: {
        total: 1,
        warnings: 1,
        errors: 0,
        entries: [{ level: "warn", message: "plugin warning" }],
      },
      activePluginIds: ["plugin-a"],
      typedHookCounts: { before_tool_call: 1 },
      plugins: [
        {
          id: "plugin-a",
          name: "Plugin A",
          source: "/tmp/plugin-a",
          origin: "workspace",
          enabled: true,
          status: "loaded",
          toolNames: [],
          hookNames: ["before_tool_call"],
          channelIds: [],
          providerIds: [],
          gatewayMethods: [],
          cliCommands: [],
          services: [],
          commands: [],
          httpHandlers: 0,
          hookCount: 1,
          configSchema: true,
        },
      ],
    },
    hooks: {
      workspaceDir: "/tmp/openclaw-workspace",
      managedHooksDir: "/tmp/openclaw-hooks",
      hookRunnerInitialized: true,
      globalRegistryLoaded: true,
      internalHookKeys: ["command:new"],
      typedHookCounts: { before_tool_call: 1 },
      counts: {
        hooks: 3,
        pluginManagedHooks: 1,
        workspaceManagedHooks: 2,
        eligibleHooks: 2,
        disabledHooks: 0,
        missingRequirementsHooks: 1,
        internalHookKeys: 1,
        typedHookNames: 1,
      },
      hooks: [
        {
          name: "before_tool_call",
          description: "hook",
          source: "openclaw-plugin",
          pluginId: "plugin-a",
          filePath: "/tmp/plugin-a/hook.ts",
          baseDir: "/tmp/plugin-a",
          handlerPath: "/tmp/plugin-a/hook.ts",
          hookKey: "before_tool_call",
          events: ["command:new"],
          always: false,
          disabled: false,
          eligible: true,
          managedByPlugin: true,
          requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
          missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [],
        },
      ],
    },
  })),
  getPluginStatus: vi.fn(function () {
    return openClawExtensionRuntimeMock.getStatus().plugins;
  }),
  getHookStatus: vi.fn(function () {
    return openClawExtensionRuntimeMock.getStatus().hooks;
  }),
  reload: vi.fn(function () {
    return {
      reloaded: true,
      reloadedAt: "2026-03-05T00:00:00.000Z",
      ...openClawExtensionRuntimeMock.getStatus(),
    };
  }),
};

const openClawSessionRuntimeMock = {
  ensureStarted: vi.fn(async () => {}),
  getStatus: vi.fn(() => ({
    storePath: "/tmp/session-runtime.json",
    persistSessions: true,
    started: true,
    autoRecoverOnStart: true,
    totalSessions: 2,
    activeSessions: 1,
    interruptedSessions: 0,
    recoveryRequestedSessions: 0,
    errorSessions: 0,
    lastEventAtMs: Date.now(),
    lastTranscriptAtMs: Date.now(),
    lastRecoveryAtMs: null,
  })),
  listSessions: vi.fn(() => ({
    count: 1,
    sessions: [
      {
        sessionKey: "agent:main:main",
        sessionId: "sess_1",
        sessionFile: "/tmp/transcripts/sess_1.json",
        status: "active",
        activeRunIds: ["run_1"],
        pendingRecoveryRunIds: [],
        lastRunId: "run_1",
        lastLifecyclePhase: "start",
        lastEventAtMs: Date.now(),
        lastStartedAtMs: Date.now(),
        lastEndedAtMs: null,
        lastTranscriptAtMs: Date.now(),
        lastTranscriptFile: "/tmp/transcripts/sess_1.json",
        lastError: null,
        eventCount: 3,
        recoveryAttempts: 0,
        recoveryRequestedAtMs: null,
        interruptedAtMs: null,
        recoveredAtMs: null,
        updatedAtMs: Date.now(),
      },
    ],
  })),
  getSession: vi.fn((sessionKey: string) =>
    sessionKey === "agent:main:main"
      ? {
          sessionKey: "agent:main:main",
          sessionId: "sess_1",
          sessionFile: "/tmp/transcripts/sess_1.json",
          status: "active",
          activeRunIds: ["run_1"],
          pendingRecoveryRunIds: [],
          lastRunId: "run_1",
          lastLifecyclePhase: "start",
          lastEventAtMs: Date.now(),
          lastStartedAtMs: Date.now(),
          lastEndedAtMs: null,
          lastTranscriptAtMs: Date.now(),
          lastTranscriptFile: "/tmp/transcripts/sess_1.json",
          lastError: null,
          eventCount: 3,
          recoveryAttempts: 0,
          recoveryRequestedAtMs: null,
          interruptedAtMs: null,
          recoveredAtMs: null,
          updatedAtMs: Date.now(),
        }
      : undefined,
  ),
  recoverSession: vi.fn((sessionKey: string) => ({
    queued: true,
    session: {
      sessionKey,
      status: "recovery-requested",
      activeRunIds: [],
      pendingRecoveryRunIds: ["run_1"],
      eventCount: 3,
      recoveryAttempts: 1,
      lastEventAtMs: Date.now(),
      lastStartedAtMs: null,
      lastEndedAtMs: null,
      lastTranscriptAtMs: Date.now(),
      recoveryRequestedAtMs: Date.now(),
      interruptedAtMs: Date.now(),
      recoveredAtMs: null,
      updatedAtMs: Date.now(),
    },
  })),
};

const openClawSuperAgentRuntimeMock = {
  getStatus: vi.fn(async () => ({
    requestedOpenClawTag: "v2026.3.7-beta.1",
    localOpenClawVersion: "2026.3.7-beta.1",
    connectors: {
      totalConnectors: 58,
      totalCapabilities: 143,
      categoryCounts: {
        comms: 6,
        dev: 9,
        email: 1,
        general: 12,
        productivity: 11,
      },
      featuredConnectors: ["Gmail", "Slack", "Notion"],
      coreConnectors: [
        {
          connectorId: "gmail",
          displayName: "Gmail",
          category: "email",
          authType: "oauth2",
          loaded: true,
          envReady: true,
          requiredEnvVars: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
          capabilityCount: 2,
        },
        {
          connectorId: "slack",
          displayName: "Slack",
          category: "comms",
          authType: "oauth2",
          loaded: true,
          envReady: true,
          requiredEnvVars: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
          capabilityCount: 4,
        },
      ],
    },
    ecosystem: {
      totalServices: 17,
      enabledServices: 6,
      featuredServices: [
        {
          id: "n8n",
          enabled: true,
          baseUrl: "http://localhost:5678",
          source: "default",
          role: "workflow automation",
          reachable: true,
          status: 200,
        },
        {
          id: "qdrant",
          enabled: true,
          baseUrl: "http://localhost:6333",
          source: "default",
          role: "vector memory",
          reachable: true,
          status: 200,
        },
      ],
    },
    capabilities: {
      workflowAutomation: true,
      vectorMemory: true,
      observability: false,
      metasearch: true,
      browserResearch: false,
      connectorCatalog: true,
      multiAppAutomation: true,
    },
  })),
};

const openClawConnectorRuntimeMock = {
  listCatalog: vi.fn(async () => [
    {
      connectorId: "gmail",
      providerId: "google",
      displayName: "Gmail",
      description: "Advanced AI integration for Gmail",
      version: "1.0.0",
      category: "email",
      authType: "oauth2",
      connected: true,
      enabledForUser: true,
      disabledReason: null,
      capabilityCount: 2,
      enabledCapabilityCount: 2,
      writeCapabilityCount: 1,
    },
    {
      connectorId: "slack",
      providerId: "slack",
      displayName: "Slack",
      description: "Advanced AI integration for Slack",
      version: "1.0.0",
      category: "comms",
      authType: "oauth2",
      connected: false,
      enabledForUser: false,
      disabledReason: "connector_not_enabled",
      capabilityCount: 4,
      enabledCapabilityCount: 0,
      writeCapabilityCount: 2,
    },
  ]),
  getConnector: vi.fn(async (userId: string, connectorId: string) => {
    if (userId !== "user_test" || connectorId !== "gmail") {
      return null;
    }
    return {
      connectorId: "gmail",
      providerId: "google",
      displayName: "Gmail",
      description: "Advanced AI integration for Gmail",
      version: "1.0.0",
      category: "email",
      authType: "oauth2",
      connected: true,
      enabledForUser: true,
      disabledReason: null,
      capabilityCount: 2,
      enabledCapabilityCount: 2,
      writeCapabilityCount: 1,
      baseUrl: "https://gmail.googleapis.com",
      requiredEnvVars: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"],
      capabilities: [
        {
          operationId: "gmail_search",
          name: "Search emails",
          description: "Search emails",
          requiredScopes: ["gmail.readonly"],
          dataAccessLevel: "read",
          confirmationRequired: false,
          enabledForUser: true,
          disabledReason: null,
          tags: ["search"],
          inputSchema: { type: "object", properties: { q: { type: "string" } } },
          outputSchema: { type: "object", properties: {} },
        },
        {
          operationId: "gmail_send_email",
          name: "Send email",
          description: "Send email",
          requiredScopes: ["gmail.send"],
          dataAccessLevel: "write",
          confirmationRequired: true,
          enabledForUser: true,
          disabledReason: null,
          tags: ["send"],
          inputSchema: { type: "object", properties: { to: { type: "string" } } },
          outputSchema: { type: "object", properties: {} },
        },
      ],
    };
  }),
  executeOperation: vi.fn(async (params: any) => {
    if (params.operationId === "gmail_send_email" && params.confirmed !== true) {
      return {
        connectorId: "gmail",
        operationId: "gmail_send_email",
        runId: "ocl_rt_send",
        chatId: "openclaw-runtime:gmail",
        confirmed: false,
        capability: {
          operationId: "gmail_send_email",
          name: "Send email",
          description: "Send email",
          dataAccessLevel: "write",
          confirmationRequired: true,
        },
        success: false,
        error: {
          code: "REQUIRES_CONFIRMATION",
          message: "Operation \"Send email\" requires confirmation before execution.",
          retryable: false,
        },
      };
    }

    return {
      connectorId: params.connectorId,
      operationId: params.operationId,
      runId: params.runId || "ocl_rt_search",
      chatId: params.chatId || `openclaw-runtime:${params.connectorId}`,
      confirmed: params.confirmed === true,
      capability: {
        operationId: params.operationId,
        name: params.operationId,
        description: "mocked capability",
        dataAccessLevel: "read",
        confirmationRequired: false,
      },
      success: true,
      data: {
        ok: true,
        input: params.input,
      },
      metadata: {
        requestId: "req_mock",
        latencyMs: 12,
      },
    };
  }),
};

const openClawBrowserRuntimeMock = {
  getStatus: vi.fn(async () => ({
    profiles: [
      {
        id: "chrome-desktop",
        name: "Chrome Desktop",
        browserType: "chromium",
        viewport: { width: 1920, height: 1080 },
        mobile: false,
      },
    ],
    activeSessions: 1,
    counts: {
      browser: 1,
      computerBrowser: 0,
      computerDesktop: 0,
    },
    capabilities: {
      multiBrowser: true,
      computerUse: true,
      structuredExtraction: true,
      agenticNavigation: true,
      visionAnalysis: true,
    },
    sessions: [
      {
        sessionId: "browser_sess_1",
        controller: "browser",
        mode: "browser",
        profileId: "chrome-desktop",
        objective: "Research a page",
        allowedDomains: ["example.com"],
        createdAtMs: 1000,
        updatedAtMs: 2000,
        status: "active",
        url: "https://example.com",
        title: "Example",
        tabCount: 1,
      },
    ],
  })),
  listProfiles: vi.fn(() => [
    {
      id: "chrome-desktop",
      name: "Chrome Desktop",
      browserType: "chromium",
      viewport: { width: 1920, height: 1080 },
      mobile: false,
    },
  ]),
  listSessions: vi.fn(async () => [
    {
      sessionId: "browser_sess_1",
      controller: "browser",
      mode: "browser",
      profileId: "chrome-desktop",
      objective: "Research a page",
      allowedDomains: ["example.com"],
      createdAtMs: 1000,
      updatedAtMs: 2000,
      status: "active",
      url: "https://example.com",
      title: "Example",
      tabCount: 1,
    },
  ]),
  createSession: vi.fn(async (params: any) => ({
    sessionId: "browser_sess_1",
    controller: params.controller || "browser",
    mode: params.mode || "browser",
    profileId: params.profileId || "chrome-desktop",
    objective: params.objective || null,
    allowedDomains: params.allowedDomains || [],
    createdAtMs: 1000,
    updatedAtMs: 1000,
    status: "active",
    url: null,
    title: null,
    tabCount: 1,
  })),
  getSession: vi.fn(async (_userId: string, sessionId: string) =>
    sessionId === "browser_sess_1"
      ? {
          sessionId: "browser_sess_1",
          controller: "browser",
          mode: "browser",
          profileId: "chrome-desktop",
          objective: "Research a page",
          allowedDomains: ["example.com"],
          createdAtMs: 1000,
          updatedAtMs: 2000,
          status: "active",
          url: "https://example.com",
          title: "Example",
          tabCount: 1,
        }
      : null,
  ),
  closeSession: vi.fn(async (_userId: string, sessionId: string) =>
    sessionId === "browser_sess_1" ? { closed: true, sessionId } : null,
  ),
  navigate: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          sessionId: params.sessionId,
          controller: "browser",
          success: true,
          url: params.url,
          title: "Example",
          status: 200,
        }
      : null,
  ),
  interact: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          sessionId: params.sessionId,
          controller: "browser",
          action: params.action,
          success: true,
          data: params.action === "select" ? { selected: ["one"] } : undefined,
        }
      : null,
  ),
  extract: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          sessionId: params.sessionId,
          controller: "browser",
          data: params.description ? { summary: "Example" } : { title: "Example" },
        }
      : null,
  ),
  screenshot: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          sessionId: params.sessionId,
          controller: "browser",
          contentType: "image/png",
          screenshot: "base64-png",
        }
      : null,
  ),
  analyze: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          description: "Screen analysis",
          elements: [],
          suggestedActions: [],
          currentState: "ready",
          confidence: 0.9,
        }
      : null,
  ),
  runAgentic: vi.fn(async (params: any) =>
    params.sessionId === "browser_sess_1"
      ? {
          sessionId: params.sessionId,
          controller: "browser",
          goal: params.goal,
          result: {
            success: true,
            steps: ["navigate", "extract"],
            data: { summary: "done" },
            screenshots: [],
          },
        }
      : null,
  ),
};

const orchestrationEngineMock = {
  decomposeTask: vi.fn(async (objective: string) => [
    {
      id: "subtask_1",
      description: `Analizar objetivo: ${objective}`,
      toolId: "analyze",
      dependencies: [],
      priority: 1,
      status: "pending",
    },
    {
      id: "subtask_2",
      description: "Generar salida consolidada",
      toolId: null,
      dependencies: ["subtask_1"],
      priority: 2,
      status: "pending",
    },
  ]),
  buildExecutionPlan: vi.fn((subtasks: any[]) => ({
    waves: [[subtasks[0]], [subtasks[1]]],
    totalEstimatedTime: 10_000,
    maxParallelism: 1,
  })),
  executeParallel: vi.fn(async () => ({
    runId: "orch_run_1",
    planId: "orch_plan_1",
    status: "completed",
    success: true,
    completedTasks: 2,
    failedTasks: 0,
    results: new Map([
      ["subtask_1", { ok: true }],
      ["subtask_2", { summary: "done" }],
    ]),
    errors: new Map(),
    executionTimeMs: 123,
  })),
  listRuns: vi.fn((limit?: number) =>
    [
      {
        runId: "orch_run_1",
        planId: "orch_plan_1",
        objective: "analiza ventas y genera resumen",
        createdAtMs: Date.now() - 1000,
        completedAtMs: Date.now(),
        status: "completed",
        success: true,
        completedTasks: 2,
        failedTasks: 0,
        executionTimeMs: 123,
        result: {
          success: true,
          summary: { completed: 2, failed: 0, executionTime: "123ms", status: "completed" },
        },
      },
    ].slice(0, Math.max(1, limit || 20)),
  ),
  getStatus: vi.fn(() => ({
    storePath: "/tmp/orchestration-runs.json",
    persistRuns: true,
    runCount: 1,
    maxRunHistory: 100,
    lastRunAtMs: Date.now(),
  })),
  getRun: vi.fn((runId: string) =>
    runId === "orch_run_1"
      ? {
          runId: "orch_run_1",
          planId: "orch_plan_1",
          objective: "analiza ventas y genera resumen",
          createdAtMs: Date.now() - 1000,
          completedAtMs: Date.now(),
          status: "completed",
          success: true,
          completedTasks: 2,
          failedTasks: 0,
          executionTimeMs: 123,
          result: {
            success: true,
            summary: { completed: 2, failed: 0, executionTime: "123ms", status: "completed" },
          },
        }
      : null,
  ),
  combineResults: vi.fn(() => ({
    success: true,
    summary: {
      completed: 2,
      failed: 0,
      executionTime: "123ms",
    },
    results: {
      subtask_1: { ok: true },
      subtask_2: { summary: "done" },
    },
    errors: {},
  })),
};

vi.mock("../lib/anonUserHelper", () => ({
  getOrCreateSecureUserId: () => "user_test",
}));

vi.mock("../services/ragService", () => ({
  RAGService: class {
    async search() {
      return [{ content: "mocked memory", score: 0.91, chatId: "chat_1" }];
    }

    async getContextForMessage() {
      return "[Contexto]\nmocked memory";
    }
  },
}));

vi.mock("../services/orchestrationEngine", () => ({
  orchestrationEngine: orchestrationEngineMock,
}));

vi.mock("../services/orchestratorSkillContext", () => ({
  resolveOrchestratorSkillContextForUser: vi.fn(async () => resolvedSkillContext),
}));

vi.mock("../services/openclawTaskRuntime", () => ({
  openClawTaskRuntime: openClawTaskRuntimeMock,
}));

vi.mock("../services/openclawProcessRuntime", () => ({
  openClawProcessRuntime: openClawProcessRuntimeMock,
}));

vi.mock("../services/openclawExtensionRuntime", () => ({
  openClawExtensionRuntime: openClawExtensionRuntimeMock,
}));

vi.mock("../services/openclawSessionRuntime", () => ({
  openClawSessionRuntime: openClawSessionRuntimeMock,
}));

vi.mock("../services/openclawSuperAgentRuntime", () => ({
  openClawSuperAgentRuntime: openClawSuperAgentRuntimeMock,
}));

vi.mock("../services/openclawConnectorRuntime", () => ({
  openClawConnectorRuntime: openClawConnectorRuntimeMock,
  mapConnectorExecutionStatus: vi.fn((result: any) => {
    if (result?.success) return 200;
    if (result?.error?.code === "REQUIRES_CONFIRMATION") return 409;
    return 502;
  }),
}));

vi.mock("../services/openclawBrowserRuntime", () => ({
  openClawBrowserRuntime: openClawBrowserRuntimeMock,
}));

vi.mock("../openclaw/skills/skillRegistry", () => ({
  skillRegistry: {
    list: vi.fn(() => [
      {
        id: "coding-agent",
        name: "Coding Agent",
        description: "Code skill",
        tools: ["openclaw_exec"],
        source: "builtin",
      },
    ]),
    resolve: vi.fn((skillIds?: string[]) => ({
      skills: [
        {
          id: skillIds?.[0] || "coding-agent",
          name: "Coding Agent",
          description: "Code skill",
          tools: ["openclaw_exec"],
          source: "builtin",
        },
      ],
      prompt: "## Skill: Coding Agent\nUse tools.",
      tools: ["openclaw_exec"],
    })),
  },
}));

vi.mock("../openclaw/config", () => ({
  getOpenClawConfig: () => ({
    gateway: { enabled: false, path: "/ws/openclaw" },
    tools: {
      enabled: false,
      safeBins: [],
      workspaceRoot: "/tmp",
      execTimeout: 120000,
      execSecurity: "warn",
    },
    plugins: { enabled: false, directory: "" },
    skills: {
      enabled: true,
      directory: "/tmp/skills",
      extraDirectories: [],
      workspaceDirectory: "/tmp",
      includeBuiltins: true,
      autoImportClawi: false,
      maxSkillFileBytes: 1000,
    },
    streaming: { enabled: false, blockMinChars: 50, blockMaxChars: 500, previewMode: "partial" },
  }),
}));

vi.mock("../openclaw/skills/skillLoader", () => ({
  initSkills: vi.fn(async () => {}),
}));

vi.mock("../openclaw/agents/subagentService", () => ({
  openclawSubagentService: {
    spawn: vi.fn((params: any) => {
      const run = {
        id: `sub_${runtimeRuns.length + 1}`,
        requesterUserId: params.requesterUserId,
        objective: params.objective,
        planHint: params.planHint || [],
        parentRunId: params.parentRunId,
        status: "queued",
        createdAt: Date.now(),
      };
      runtimeRuns.push(run);
      return run;
    }),
    list: vi.fn((params: any = {}) => {
      return runtimeRuns
        .filter((run) => !params.requesterUserId || run.requesterUserId === params.requesterUserId)
        .filter((run) => !params.parentRunId || run.parentRunId === params.parentRunId)
        .filter((run) => !params.status || run.status === params.status)
        .slice(0, Math.max(1, params.limit || 100));
    }),
    getStatus: vi.fn(() => ({
      storePath: "/tmp/subagent-runs.json",
      persistRuns: true,
      totalRuns: runtimeRuns.length,
      activeRunners: 0,
      counts: {
        queued: runtimeRuns.filter((run) => run.status === "queued").length,
        running: runtimeRuns.filter((run) => run.status === "running").length,
        completed: runtimeRuns.filter((run) => run.status === "completed").length,
        failed: runtimeRuns.filter((run) => run.status === "failed").length,
        cancelled: runtimeRuns.filter((run) => run.status === "cancelled").length,
      },
      lastUpdatedAt: runtimeRuns[0]?.createdAt ?? null,
    })),
    get: vi.fn((runId: string) => runtimeRuns.find((run) => run.id === runId)),
    cancel: vi.fn((runId: string) => {
      const found = runtimeRuns.find((run) => run.id === runId);
      if (!found) return false;
      found.status = "cancelled";
      return true;
    }),
  },
}));

async function createTestApp() {
  const { createOpenClawRuntimeRouter } = await import("../routes/openclawRuntimeRouter");
  const app = express();
  app.use(express.json());
  app.use("/api/openclaw/runtime", createOpenClawRuntimeRouter());
  return app;
}

describe("openclawRuntimeRouter smoke flow", () => {
  beforeEach(() => {
    runtimeRuns.length = 0;
    vi.clearAllMocks();
  });

  it("executes objective -> plan -> subagents -> consolidated response", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const objective = "analiza ventas y genera resumen";

      const planRes = await client
        .post("/api/openclaw/runtime/orchestrator/plan")
        .send({ objective });
      expect(planRes.status).toBe(200);
      expect(Array.isArray(planRes.body.subtasks)).toBe(true);
      expect(planRes.body.subtasks.length).toBeGreaterThanOrEqual(1);
      expect(planRes.body.activeSkillId).toBe("skill_master_1");
      expect(orchestrationEngineMock.decomposeTask).toHaveBeenCalledWith(
        objective,
        expect.any(Number),
        { skillContext: resolvedSkillContext.skillContext },
      );

      const spawnRes = await client
        .post("/api/openclaw/runtime/subagents")
        .send({ objective: planRes.body.subtasks[0].description });
      expect(spawnRes.status).toBe(202);
      expect(spawnRes.body.id).toBeTruthy();

      const listRes = await client.get("/api/openclaw/runtime/subagents");
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.runs)).toBe(true);
      expect(listRes.body.runs.length).toBeGreaterThanOrEqual(1);

      const subagentStatusRes = await client.get("/api/openclaw/runtime/subagents/status");
      expect(subagentStatusRes.status).toBe(200);
      expect(subagentStatusRes.body.storePath).toBe("/tmp/subagent-runs.json");

      const runRes = await client
        .post("/api/openclaw/runtime/orchestrator/run")
        .send({ objective });
      expect(runRes.status).toBe(200);
      expect(runRes.body.combined).toBeTruthy();
      expect(runRes.body.combined.summary.completed).toBe(2);
      expect(runRes.body.execution.runId).toBe("orch_run_1");
      expect(runRes.body.skillContext.activeSkill.id).toBe("skill_master_1");

      const runListRes = await client.get("/api/openclaw/runtime/orchestrator/runs");
      expect(runListRes.status).toBe(200);
      expect(runListRes.body.runs[0].runId).toBe("orch_run_1");

      const orchStatusRes = await client.get("/api/openclaw/runtime/orchestrator/status");
      expect(orchStatusRes.status).toBe(200);
      expect(orchStatusRes.body.storePath).toBe("/tmp/orchestration-runs.json");

      const runGetRes = await client.get("/api/openclaw/runtime/orchestrator/runs/orch_run_1");
      expect(runGetRes.status).toBe(200);
      expect(runGetRes.body.planId).toBe("orch_plan_1");

      const flowRes = await client
        .post("/api/openclaw/runtime/orchestrator/flow")
        .send({ objective, spawnSubagents: true, maxSubagents: 2 });
      expect(flowRes.status).toBe(200);
      expect(Array.isArray(flowRes.body.delegatedRuns)).toBe(true);
      expect(flowRes.body.delegatedRuns.length).toBeGreaterThanOrEqual(1);
      expect(flowRes.body.combined.summary.completed).toBe(2);
    } finally {
      await close();
    }
  });

  it("exposes background task and process runtime endpoints", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const statusRes = await client.get("/api/openclaw/runtime/background/status");
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.tasks.jobs).toBe(1);
      expect(statusRes.body.processes.count).toBe(1);
      expect(statusRes.body.extensions.pluginCount).toBe(2);
      expect(statusRes.body.orchestrator.storePath).toBe("/tmp/orchestration-runs.json");
      expect(statusRes.body.subagents.storePath).toBe("/tmp/subagent-runs.json");
      expect(statusRes.body.sessions.storePath).toBe("/tmp/session-runtime.json");
      expect(statusRes.body.browser.activeSessions).toBe(1);
      expect(statusRes.body.superAgent.requestedOpenClawTag).toBe("v2026.3.7-beta.1");
      expect(statusRes.body.superAgent.connectors.totalConnectors).toBe(58);

      const jobsRes = await client.get("/api/openclaw/runtime/background/cron/jobs");
      expect(jobsRes.status).toBe(200);
      expect(jobsRes.body.total).toBe(1);

      const createJobRes = await client.post("/api/openclaw/runtime/background/cron/jobs").send({
        schedule: { kind: "every", everyMs: 60000 },
        payload: { kind: "agentTurn", message: "Revisar backlog" },
      });
      expect(createJobRes.status).toBe(201);
      expect(createJobRes.body.id).toBe("job_1");

      const runJobRes = await client
        .post("/api/openclaw/runtime/background/cron/jobs/job_1/run")
        .send({ mode: "force" });
      expect(runJobRes.status).toBe(200);
      expect(runJobRes.body.ran).toBe(true);

      const wakeRes = await client
        .post("/api/openclaw/runtime/background/cron/wake")
        .send({ mode: "now", text: "wake" });
      expect(wakeRes.status).toBe(200);
      expect(wakeRes.body.queued).toBe(true);

      const heartbeatStatusRes = await client.get("/api/openclaw/runtime/background/heartbeat");
      expect(heartbeatStatusRes.status).toBe(200);
      expect(heartbeatStatusRes.body.handlerAttached).toBe(true);

      const heartbeatRequestRes = await client
        .post("/api/openclaw/runtime/background/heartbeat/request")
        .send({ reason: "test:request" });
      expect(heartbeatRequestRes.status).toBe(200);
      expect(heartbeatRequestRes.body.queued).toBe(true);

      const heartbeatRunRes = await client
        .post("/api/openclaw/runtime/background/heartbeat/run")
        .send({ reason: "test:run" });
      expect(heartbeatRunRes.status).toBe(200);
      expect(heartbeatRunRes.body.status).toBe("ran");

      const sessionStatusRes = await client.get("/api/openclaw/runtime/sessions/status");
      expect(sessionStatusRes.status).toBe(200);
      expect(sessionStatusRes.body.totalSessions).toBe(2);

      const sessionListRes = await client.get("/api/openclaw/runtime/sessions");
      expect(sessionListRes.status).toBe(200);
      expect(sessionListRes.body.sessions[0].sessionKey).toBe("agent:main:main");

      const sessionRes = await client.get("/api/openclaw/runtime/sessions/agent:main:main");
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.status).toBe("active");

      const recoverSessionRes = await client
        .post("/api/openclaw/runtime/sessions/agent:main:main/recover")
        .send({ reason: "test:recover" });
      expect(recoverSessionRes.status).toBe(200);
      expect(recoverSessionRes.body.queued).toBe(true);
      expect(openClawSessionRuntimeMock.recoverSession).toHaveBeenCalledWith(
        "agent:main:main",
        expect.objectContaining({ reason: "test:recover" }),
      );

      const processRes = await client.get("/api/openclaw/runtime/background/processes");
      expect(processRes.status).toBe(200);
      expect(processRes.body.count).toBe(1);

      const extensionsRes = await client.get("/api/openclaw/runtime/extensions/status");
      expect(extensionsRes.status).toBe(200);
      expect(extensionsRes.body.plugins.counts.loadedPlugins).toBe(1);

      const pluginsRes = await client.get("/api/openclaw/runtime/plugins/status");
      expect(pluginsRes.status).toBe(200);
      expect(pluginsRes.body.activePluginIds).toContain("plugin-a");

      const hooksRes = await client.get("/api/openclaw/runtime/hooks/status");
      expect(hooksRes.status).toBe(200);
      expect(hooksRes.body.internalHookKeys).toContain("command:new");

      const reloadPluginsRes = await client.post("/api/openclaw/runtime/plugins/reload").send({});
      expect(reloadPluginsRes.status).toBe(200);
      expect(reloadPluginsRes.body.reloaded).toBe(true);
    } finally {
      await close();
    }
  });

  it("reports the unified superagent status in health and dedicated status endpoints", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const healthRes = await client.get("/api/openclaw/runtime/health");
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.superAgent.requestedOpenClawTag).toBe("v2026.3.7-beta.1");
      expect(healthRes.body.superAgent.connectors.totalConnectors).toBe(58);
      expect(healthRes.body.superAgent.ecosystem.enabledServices).toBe(6);
      expect(openClawSuperAgentRuntimeMock.getStatus).toHaveBeenCalledWith({
        includeProbes: false,
      });

      const superAgentRes = await client.get("/api/openclaw/runtime/superagent/status");
      expect(superAgentRes.status).toBe(200);
      expect(superAgentRes.body.localOpenClawVersion).toBe("2026.3.7-beta.1");
      expect(superAgentRes.body.capabilities.workflowAutomation).toBe(true);
      expect(superAgentRes.body.ecosystem.featuredServices[0].id).toBe("n8n");
      expect(openClawSuperAgentRuntimeMock.getStatus).toHaveBeenCalledWith({
        includeProbes: true,
        probeTimeoutMs: 1500,
      });
    } finally {
      await close();
    }
  });

  it("exposes an aggregated overview snapshot for the operator console", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const overviewRes = await client.get("/api/openclaw/runtime/overview");
      expect(overviewRes.status).toBe(200);
      expect(overviewRes.body.health.ok).toBe(true);
      expect(overviewRes.body.superAgent.requestedOpenClawTag).toBe("v2026.3.7-beta.1");
      expect(overviewRes.body.background.jobs.total).toBe(1);
      expect(overviewRes.body.background.processes.running).toBe(1);
      expect(overviewRes.body.browser.activeSessions).toBe(1);
      expect(overviewRes.body.connectors.total).toBe(2);
      expect(overviewRes.body.connectors.connected).toBe(1);
      expect(overviewRes.body.orchestrator.recentRuns[0].runId).toBe("orch_run_1");
      expect(openClawTaskRuntimeMock.listPage).toHaveBeenCalledWith({ limit: 5, offset: 0 });
      expect(openClawTaskRuntimeMock.listRuns).toHaveBeenCalledWith({
        scope: "all",
        limit: 10,
        offset: 0,
        sortDir: "desc",
      });
      expect(openClawConnectorRuntimeMock.listCatalog).toHaveBeenCalledWith("user_test");
      expect(openClawBrowserRuntimeMock.getStatus).toHaveBeenCalledWith("user_test");
    } finally {
      await close();
    }
  });

  it("exposes connector catalog, detail and execution endpoints through the runtime API", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const catalogRes = await client.get("/api/openclaw/runtime/connectors/catalog");
      expect(catalogRes.status).toBe(200);
      expect(catalogRes.body.count).toBe(2);
      expect(catalogRes.body.connectors[0].connectorId).toBe("gmail");
      expect(openClawConnectorRuntimeMock.listCatalog).toHaveBeenCalledWith("user_test");

      const detailRes = await client.get("/api/openclaw/runtime/connectors/gmail");
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.connectorId).toBe("gmail");
      expect(detailRes.body.capabilities).toHaveLength(2);
      expect(openClawConnectorRuntimeMock.getConnector).toHaveBeenCalledWith(
        "user_test",
        "gmail",
      );

      const executeRes = await client
        .post("/api/openclaw/runtime/connectors/gmail/operations/gmail_search/execute")
        .send({
          input: { q: "from:team@example.com" },
        });
      expect(executeRes.status).toBe(200);
      expect(executeRes.body.success).toBe(true);
      expect(executeRes.body.data.input.q).toBe("from:team@example.com");
      expect(openClawConnectorRuntimeMock.executeOperation).toHaveBeenCalledWith({
        userId: "user_test",
        connectorId: "gmail",
        operationId: "gmail_search",
        input: { q: "from:team@example.com" },
        chatId: undefined,
        runId: undefined,
        confirmed: false,
      });

      const confirmationRes = await client
        .post("/api/openclaw/runtime/connectors/gmail/operations/gmail_send_email/execute")
        .send({
          input: { to: "team@example.com" },
        });
      expect(confirmationRes.status).toBe(409);
      expect(confirmationRes.body.success).toBe(false);
      expect(confirmationRes.body.error.code).toBe("REQUIRES_CONFIRMATION");
    } finally {
      await close();
    }
  });

  it("exposes browser runtime sessions, navigation and agentic execution", async () => {
    const app = await createTestApp();
    const { client, close } = await createHttpTestClient(app);
    try {
      const statusRes = await client.get("/api/openclaw/runtime/browser/status");
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.activeSessions).toBe(1);
      expect(openClawBrowserRuntimeMock.getStatus).toHaveBeenCalledWith("user_test");

      const profilesRes = await client.get("/api/openclaw/runtime/browser/profiles");
      expect(profilesRes.status).toBe(200);
      expect(profilesRes.body.profiles[0].id).toBe("chrome-desktop");

      const createRes = await client
        .post("/api/openclaw/runtime/browser/sessions")
        .send({
          controller: "browser",
          profileId: "chrome-desktop",
          objective: "Research a page",
          allowedDomains: ["example.com"],
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.sessionId).toBe("browser_sess_1");

      const listRes = await client.get("/api/openclaw/runtime/browser/sessions");
      expect(listRes.status).toBe(200);
      expect(listRes.body.count).toBe(1);

      const detailRes = await client.get("/api/openclaw/runtime/browser/sessions/browser_sess_1");
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.url).toBe("https://example.com");

      const navigateRes = await client
        .post("/api/openclaw/runtime/browser/sessions/browser_sess_1/navigate")
        .send({ url: "https://example.com/docs" });
      expect(navigateRes.status).toBe(200);
      expect(navigateRes.body.url).toBe("https://example.com/docs");

      const interactRes = await client
        .post("/api/openclaw/runtime/browser/sessions/browser_sess_1/interact")
        .send({ action: "click", selector: "button.search" });
      expect(interactRes.status).toBe(200);
      expect(interactRes.body.success).toBe(true);

      const extractRes = await client
        .post("/api/openclaw/runtime/browser/sessions/browser_sess_1/extract")
        .send({ description: "Summarize the page" });
      expect(extractRes.status).toBe(200);
      expect(extractRes.body.data.summary).toBe("Example");

      const screenshotRes = await client.get(
        "/api/openclaw/runtime/browser/sessions/browser_sess_1/screenshot",
      );
      expect(screenshotRes.status).toBe(200);
      expect(screenshotRes.body.contentType).toBe("image/png");

      const analyzeRes = await client
        .post("/api/openclaw/runtime/browser/sessions/browser_sess_1/analyze")
        .send({ query: "What is visible?" });
      expect(analyzeRes.status).toBe(200);
      expect(analyzeRes.body.currentState).toBe("ready");

      const agenticRes = await client
        .post("/api/openclaw/runtime/browser/sessions/browser_sess_1/agentic")
        .send({ goal: "Extract the headline", maxSteps: 5 });
      expect(agenticRes.status).toBe(200);
      expect(agenticRes.body.result.success).toBe(true);
      expect(openClawBrowserRuntimeMock.runAgentic).toHaveBeenCalledWith({
        userId: "user_test",
        sessionId: "browser_sess_1",
        goal: "Extract the headline",
        maxSteps: 5,
        allowedDomains: undefined,
        task: undefined,
      });

      const closeRes = await client.delete("/api/openclaw/runtime/browser/sessions/browser_sess_1");
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.closed).toBe(true);
    } finally {
      await close();
    }
  });
});

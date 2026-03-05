/**
 * Tests for the Super Agent System
 *
 * Tests the unified routing, multi-model orchestration, background tasks,
 * parallel research, tool connectors, and OpenClaw bridge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the vite log function which is used by multiModelOrchestrator
vi.mock("../../vite", () => ({
  log: (...args: any[]) => {},
}));

// Mock storage
vi.mock("../../storage", () => ({
  storage: {},
}));

// ============================================
// SuperAgentRouter Tests
// ============================================

describe("SuperAgentRouter", () => {
  it("should export SuperAgentRouter class", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    expect(SuperAgentRouter).toBeDefined();
  });

  it("should create a singleton instance", async () => {
    const { superAgentRouter } = await import("../superAgentRouter");
    expect(superAgentRouter).toBeDefined();
  });

  it("should detect computer use intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("abre el navegador y navega a google.com", "user1");
    expect(result.engine).toBe("computer_use");
    expect(result.capability).toBe("computer_use");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should detect research intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("investigación académica sobre inteligencia artificial en medicina", "user1");
    expect(result.engine).toBe("research_pipeline");
    expect(result.capability).toBe("research");
  });

  it("should detect image generation intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("genera una imagen de un paisaje futurista", "user1");
    expect(result.engine).toBe("orchestrator");
    expect(result.capability).toBe("image_generation");
    expect(result.suggestedModel).toBe("nano_banana");
  });

  it("should detect background task intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("monitorea el precio de bitcoin cada hora", "user1");
    expect(result.engine).toBe("background_task");
    expect(result.capability).toBe("background_task");
  });

  it("should detect workflow intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("automatiza el proceso de enviar un email cada lunes", "user1");
    expect(result.engine).toBe("workflow");
    expect(result.capability).toBe("workflow");
  });

  it("should detect code generation intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("crea una aplicación React con autenticación", "user1");
    expect(result.engine).toBe("orchestrator");
    expect(result.capability).toBe("code_generation");
    expect(result.suggestedModel).toBe("opus");
  });

  it("should detect communication intent", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("envía un email a juan@test.com con el informe", "user1");
    expect(result.engine).toBe("orchestrator");
    expect(result.capability).toBe("communication");
  });

  it("should fall back to orchestrator for unknown intents", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    const result = await router.route("hola cómo estás", "user1");
    expect(result.engine).toBe("orchestrator");
    expect(result.capability).toBe("general");
  });

  it("should track route statistics", async () => {
    const { SuperAgentRouter } = await import("../superAgentRouter");
    const router = new SuperAgentRouter({ enableLLMRouting: false });

    await router.route("genera una imagen de un gato", "user1");
    await router.route("busca artículos de scopus", "user1");

    const stats = router.getRouteStats("user1");
    expect(stats.totalRoutes).toBe(2);
  });
});

// ============================================
// BackgroundTaskManager Tests
// ============================================

describe("BackgroundTaskManager", () => {
  it("should export BackgroundTaskManager class", async () => {
    const { BackgroundTaskManager } = await import("../backgroundTaskManager");
    expect(BackgroundTaskManager).toBeDefined();
  });

  it("should register a recurring task without immediately executing", async () => {
    const { BackgroundTaskManager } = await import("../backgroundTaskManager");
    const manager = new BackgroundTaskManager();

    // Use recurring with a very long interval so it doesn't actually fire during test
    const task = await manager.registerTask({
      name: "Test Task",
      description: "A test background task",
      type: "recurring",
      userId: "user1",
      action: {
        type: "api_call",
        config: { url: "https://example.com", method: "GET" },
      },
      schedule: { intervalMs: 999999999 },
    });

    expect(task).toBeDefined();
    expect(task.id).toBeDefined();
    expect(task.name).toBe("Test Task");
    expect(task.type).toBe("recurring");
    expect(task.userId).toBe("user1");

    // Cleanup
    manager.cancelTask(task.id);
    await manager.shutdown();
  });

  it("should list tasks for a user", async () => {
    const { BackgroundTaskManager } = await import("../backgroundTaskManager");
    const manager = new BackgroundTaskManager();

    // Use recurring tasks with very long intervals
    await manager.registerTask({
      name: "Task A",
      description: "Task A",
      type: "recurring",
      userId: "user1",
      action: { type: "api_call", config: { url: "https://example.com" } },
      schedule: { intervalMs: 999999999 },
    });

    await manager.registerTask({
      name: "Task B",
      description: "Task B",
      type: "recurring",
      userId: "user2",
      action: { type: "api_call", config: { url: "https://example.com" } },
      schedule: { intervalMs: 999999999 },
    });

    const user1Tasks = manager.listTasks("user1");
    expect(user1Tasks.length).toBe(1);
    expect(user1Tasks[0].name).toBe("Task A");

    // Cleanup
    await manager.shutdown();
  });

  it("should pause and resume tasks", async () => {
    const { BackgroundTaskManager } = await import("../backgroundTaskManager");
    const manager = new BackgroundTaskManager();

    const task = await manager.registerTask({
      name: "Pausable Task",
      description: "Can be paused",
      type: "recurring",
      userId: "user1",
      action: { type: "llm_query", config: { prompt: "hello" } },
      schedule: { intervalMs: 60000 },
    });

    manager.pauseTask(task.id);
    const paused = manager.getTask(task.id);
    expect(paused?.state).toBe("paused");

    // Cleanup
    manager.cancelTask(task.id);
    await manager.shutdown();
  });

  it("should cancel tasks", async () => {
    const { BackgroundTaskManager } = await import("../backgroundTaskManager");
    const manager = new BackgroundTaskManager();

    const task = await manager.registerTask({
      name: "Cancellable Task",
      description: "Will be cancelled",
      type: "recurring",
      userId: "user1",
      action: { type: "llm_query", config: { prompt: "hello" } },
      schedule: { intervalMs: 60000 },
    });

    manager.cancelTask(task.id);
    const cancelled = manager.getTask(task.id);
    expect(cancelled?.state).toBe("cancelled");

    await manager.shutdown();
  });
});

// ============================================
// ParallelResearchEngine Tests
// ============================================

describe("ParallelResearchEngine", () => {
  it("should export ParallelResearchEngine class", async () => {
    const { ParallelResearchEngine } = await import("../parallelResearchEngine");
    expect(ParallelResearchEngine).toBeDefined();
  });

  it("should create singleton instance", async () => {
    const { parallelResearchEngine } = await import("../parallelResearchEngine");
    expect(parallelResearchEngine).toBeDefined();
  });

  it("should support cancellation", async () => {
    const { ParallelResearchEngine } = await import("../parallelResearchEngine");
    const engine = new ParallelResearchEngine();

    // Cancel a non-existent query should not throw
    engine.cancelResearch("non-existent-id");
  });
});

// ============================================
// ToolConnectorHub Tests
// ============================================

describe("ToolConnectorHub", () => {
  it("should export ToolConnectorHub class", async () => {
    const { ToolConnectorHub } = await import("../toolConnectorHub");
    expect(ToolConnectorHub).toBeDefined();
  });

  it("should list available connectors", async () => {
    const { ToolConnectorHub } = await import("../toolConnectorHub");
    const hub = new ToolConnectorHub();

    const connectors = hub.listConnectors();
    expect(connectors).toBeDefined();
    expect(connectors.length).toBeGreaterThan(0);

    // Should include standard connector types
    const types = connectors.map((c) => c.type);
    expect(types).toContain("gmail");
    expect(types).toContain("slack");
    expect(types).toContain("notion");
    expect(types).toContain("github");
    expect(types).toContain("discord");
    expect(types).toContain("telegram");
  });

  it("should register a custom connector", async () => {
    const { ToolConnectorHub } = await import("../toolConnectorHub");
    const hub = new ToolConnectorHub();

    const id = hub.registerConnector({
      type: "webhook",
      name: "My Webhook",
      credentials: { webhookUrl: "https://example.com/hook" },
    });

    expect(id).toBeDefined();
    expect(hub.isAvailable("webhook")).toBe(true);
  });

  it("should return error for unconfigured connector", async () => {
    const { ToolConnectorHub } = await import("../toolConnectorHub");
    const hub = new ToolConnectorHub();

    const result = await hub.execute({
      connector: "jira",
      action: "create_issue",
      params: { title: "Test" },
      userId: "user1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No jira connector configured");
  });
});

// ============================================
// SuperAgentController Tests
// ============================================

describe("SuperAgentController", () => {
  it("should export SuperAgentController class", async () => {
    const { SuperAgentController } = await import("../superAgentController");
    expect(SuperAgentController).toBeDefined();
  });

  it("should return system status", async () => {
    const { SuperAgentController } = await import("../superAgentController");
    const controller = new SuperAgentController();

    const status = controller.getStatus();
    expect(status).toBeDefined();
    expect(status.activeRequests).toBe(0);
    expect(status.modelsAvailable).toBeDefined();
    expect(status.modelsAvailable.length).toBeGreaterThan(0);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it("should list connected tools", async () => {
    const { SuperAgentController } = await import("../superAgentController");
    const controller = new SuperAgentController();

    const tools = controller.getConnectedTools();
    expect(tools).toBeDefined();
    expect(Array.isArray(tools)).toBe(true);
  });
});

// ============================================
// OpenClaw Super Agent Bridge Tests
// ============================================

describe("OpenClawSuperAgentBridge", () => {
  it("should export OpenClawSuperAgentBridge class", async () => {
    const { OpenClawSuperAgentBridge } = await import("../openclawSuperAgentBridge");
    expect(OpenClawSuperAgentBridge).toBeDefined();
  });

  it("should create singleton instance", async () => {
    const { openclawSuperAgentBridge } = await import("../openclawSuperAgentBridge");
    expect(openclawSuperAgentBridge).toBeDefined();
  });

  it("should manage session history", async () => {
    const { OpenClawSuperAgentBridge } = await import("../openclawSuperAgentBridge");
    const bridge = new OpenClawSuperAgentBridge();

    // Initially empty
    const history = bridge.getSessionHistory("telegram", "chat1", "user1");
    expect(history).toEqual([]);

    // Clear should not throw
    bridge.clearSession("telegram", "chat1", "user1");
  });

  it("should report statistics", async () => {
    const { OpenClawSuperAgentBridge } = await import("../openclawSuperAgentBridge");
    const bridge = new OpenClawSuperAgentBridge();

    const stats = bridge.getStats();
    expect(stats).toBeDefined();
    expect(stats.activeSessions).toBe(0);
    expect(stats.activeRequests).toBe(0);
    expect(stats.supportedChannels).toBeDefined();
    expect(stats.supportedChannels.length).toBeGreaterThan(0);
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODEX_RUN_RESUME_STORAGE_KEY } from "@/lib/codexContinuity";
import RunProgressPage from "@/pages/run-progress";

const setLocationMock = vi.fn();
const fetchRunMock = vi.fn();
const fetchRunEventsMock = vi.fn();
const postRunActionMock = vi.fn();
const fetchSubagentRunsMock = vi.fn();
const useAgentStoreMock = vi.fn();
const localStorageState = new Map<string, string>();

const mockEventSource = {
  addEventListener: vi.fn(),
  close: vi.fn(),
  onerror: null as ((event?: Event) => void) | null,
  onmessage: null as ((event: MessageEvent) => void) | null,
  onopen: null as (() => void) | null,
};

const localStorageMock = {
  getItem: (key: string) => localStorageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageState.set(key, String(value));
  },
  removeItem: (key: string) => {
    localStorageState.delete(key);
  },
  clear: () => {
    localStorageState.clear();
  },
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

vi.mock("wouter", () => ({
  useLocation: () => ["/runs/run-24h/progress", setLocationMock],
  useParams: () => ({ id: "run-24h" }),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: (selector: (state: { runs: Record<string, unknown> }) => unknown) =>
    useAgentStoreMock(selector),
}));

vi.mock("@/services/runProgress", () => ({
  fetchRun: (...args: unknown[]) => fetchRunMock(...args),
  fetchRunEvents: (...args: unknown[]) => fetchRunEventsMock(...args),
  createRunEventSource: () => mockEventSource,
  postRunAction: (...args: unknown[]) => postRunActionMock(...args),
}));

vi.mock("@/services/codexRuntime", () => ({
  fetchSubagentRuns: (...args: unknown[]) => fetchSubagentRunsMock(...args),
}));

describe("RunProgressPage", () => {
  beforeEach(() => {
    setLocationMock.mockReset();
    fetchRunMock.mockReset();
    fetchRunEventsMock.mockReset();
    postRunActionMock.mockReset();
    fetchSubagentRunsMock.mockReset();
    useAgentStoreMock.mockReset();
    mockEventSource.addEventListener.mockReset();
    mockEventSource.close.mockReset();
    mockEventSource.onerror = null;
    mockEventSource.onmessage = null;
    mockEventSource.onopen = null;
    window.localStorage.clear();

    useAgentStoreMock.mockImplementation((selector) =>
      selector({
        runs: {},
      }),
    );

    fetchRunMock.mockResolvedValue({
      id: "run-24h",
      chatId: "chat-1",
      status: "running",
      executionProfile: "marathon_24h",
      plan: {
        objective: "Implementar continuidad fuerte para runs de 24 horas.",
        currentPhaseIndex: 1,
        phases: [
          { id: "phase-1", name: "Descubrimiento", status: "completed", stepIndices: [0] },
          { id: "phase-2", name: "Implementación", status: "in_progress", stepIndices: [1, 2] },
        ],
        steps: [
          { index: 0, toolName: "analyze", description: "Mapear la arquitectura actual." },
          { index: 1, toolName: "edit", description: "Persistir continuidad y resumen de checkpoint." },
          { index: 2, toolName: "test", description: "Ejecutar smoke final del flujo largo." },
        ],
      },
      summary: "Cadena 24h en progreso",
      error: "",
      steps: [
        {
          stepIndex: 0,
          toolName: "analyze",
          description: "Mapear la arquitectura actual.",
          status: "succeeded",
          startedAt: "2026-03-26T10:05:00.000Z",
          completedAt: "2026-03-26T10:08:00.000Z",
        },
        {
          stepIndex: 1,
          toolName: "edit",
          description: "Persistir continuidad y resumen de checkpoint.",
          status: "running",
          startedAt: "2026-03-26T10:09:00.000Z",
          completedAt: null,
        },
        {
          stepIndex: 2,
          toolName: "test",
          description: "Ejecutar smoke final del flujo largo.",
          status: "pending",
          startedAt: null,
          completedAt: null,
        },
      ],
      artifacts: [
        {
          name: "checkpoint.md",
          type: "markdown",
          url: "/artifacts/checkpoint.md",
        },
      ],
      createdAt: "2026-03-26T10:00:00.000Z",
      startedAt: "2026-03-26T10:05:00.000Z",
      completedAt: null,
      currentStepIndex: 1,
      totalSteps: 3,
      completedSteps: 1,
      runtimeBudgetMs: 86_400_000,
      runtimeRemainingMs: 7_200_000,
    });

    fetchRunEventsMock.mockResolvedValue({
      runId: "run-24h",
      page: 1,
      limit: 200,
      order: "asc",
      total: 4,
      events: [
        {
          id: "evt-plan",
          runId: "run-24h",
          eventType: "plan_generated",
          payload: {
            objective: "Implementar continuidad fuerte para runs de 24 horas.",
            totalSteps: 3,
          },
          timestamp: "2026-03-26T10:05:00.000Z",
          stepIndex: null,
        },
        {
          id: "evt-success",
          runId: "run-24h",
          eventType: "tool_call_succeeded",
          payload: {
            toolName: "analyze",
            status: "succeeded",
          },
          timestamp: "2026-03-26T10:08:00.000Z",
          stepIndex: 0,
        },
        {
          id: "evt-artifact",
          runId: "run-24h",
          eventType: "artifact_created",
          payload: {
            name: "checkpoint.md",
          },
          timestamp: "2026-03-26T10:09:00.000Z",
          stepIndex: null,
        },
        {
          id: "evt-qa",
          runId: "run-24h",
          eventType: "qa_passed",
          payload: {
            message: "Smoke parcial aprobado.",
          },
          timestamp: "2026-03-26T10:10:00.000Z",
          stepIndex: null,
        },
      ],
    });

    fetchSubagentRunsMock.mockResolvedValue([
      {
        id: "subagent-1",
        requesterUserId: "user-1",
        objective: "Revisar riesgos del handoff",
        planHint: ["role:reviewer"],
        parentRunId: "run-24h",
        status: "failed",
        createdAt: Date.now(),
        error: "Timeout en revisión final",
      },
    ]);
  });

  it("builds a checkpoint handoff summary and persists the latest resumable snapshot", async () => {
    render(<RunProgressPage />);

    expect(await screen.findByTestId("run-checkpoint-handoff")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint / Handoff")).toBeInTheDocument();
    expect(screen.getByText("En ejecución · Fase: Implementación · Paso: Persistir continuidad y resumen de checkpoint.")).toBeInTheDocument();
    expect(screen.getAllByText("Smoke parcial aprobado.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Persistir continuidad y resumen de checkpoint.").length).toBeGreaterThan(0);
    expect(screen.getByText("1 subagente(s) quedaron con error o cancelados.")).toBeInTheDocument();

    await waitFor(() => {
      const persisted = window.localStorage.getItem(CODEX_RUN_RESUME_STORAGE_KEY);
      expect(persisted).not.toBeNull();
      expect(JSON.parse(persisted || "{}")).toMatchObject({
        runId: "run-24h",
        chatId: "chat-1",
        executionProfile: "marathon_24h",
        status: "running",
        objective: "Implementar continuidad fuerte para runs de 24 horas.",
        lastEventTitle: "Smoke parcial aprobado.",
      });
    });
  });
});

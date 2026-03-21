import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentRunContent } from "./AgentRunContent";

vi.mock("@/lib/agent-event-mapper", () => ({
  normalizeAgentEvent: (event: {
    type: string;
    content?: { summary?: string };
    timestamp: number;
  }) => ({
    id: `${event.type}-${event.timestamp}`,
    kind: "action",
    status: "ok",
    title: "Analizando documento",
    summary: event.content?.summary ?? "Leyendo el archivo subido",
    payload: {},
    ui: {
      icon: "check",
      iconColor: "text-emerald-500",
      label: "progreso",
    },
  }),
  hasPayloadDetails: () => false,
}));

vi.mock("@/components/agent-steps-display", () => ({
  AgentStepsDisplay: () => <div data-testid="mock-agent-steps" />,
}));

vi.mock("@/components/agent/PlanViewer", () => ({
  PlanViewer: () => <div data-testid="mock-plan-viewer" />,
}));

vi.mock("@/components/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
  MarkdownErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/chat/JsonArgumentsViewer", () => ({
  JsonArgumentsViewer: () => <div data-testid="mock-json-arguments" />,
}));

vi.mock("@/components/chat/ToolInvocationCard", () => ({
  ToolInvocationCard: () => <div data-testid="mock-tool-card" />,
}));

describe("AgentRunContent", () => {
  it("shows recent activity and final summary for completed agent runs", () => {
    render(
      <AgentRunContent
        agentRun={{
          runId: "run-42",
          status: "completed",
          userMessage: "de que trata este documento?",
          steps: [],
          eventStream: [
            {
              type: "tool.result",
              content: { summary: "Documento procesado correctamente." },
              timestamp: Date.now(),
            },
          ],
          summary: "Tema principal del documento.",
          error: null,
        }}
      />,
    );

    expect(screen.getByText("Modo agente")).toBeInTheDocument();
    expect(screen.getByText("Actividad reciente")).toBeInTheDocument();
    expect(screen.getByText("Resultado final")).toBeInTheDocument();
    expect(
      screen.getAllByText("Tema principal del documento.").length,
    ).toBeGreaterThanOrEqual(1);
  });
});

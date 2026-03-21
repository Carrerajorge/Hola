import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CodexPage from "@/pages/codex";

const setLocationMock = vi.fn();
const useAuthMock = vi.fn();
const useChatsMock = vi.fn();
const useProjectsMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/codex", setLocationMock],
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/hooks/use-chats", () => ({
  useChats: () => useChatsMock(),
}));

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => useProjectsMock(),
}));

describe("CodexPage", () => {
  beforeEach(() => {
    setLocationMock.mockReset();
    useAuthMock.mockReset();
    useChatsMock.mockReset();
    useProjectsMock.mockReset();

    useAuthMock.mockReturnValue({
      user: {
        fullName: "Admin QA",
        email: "admin@example.com",
      },
    });

    useChatsMock.mockReturnValue({
      allChats: [
        {
          id: "chat-2",
          stableKey: "chat-2",
          title: "Polish Codex screen",
          timestamp: Date.now() - 5 * 60 * 1000,
          messages: [
            {
              id: "user-2",
              role: "user",
              content: "Haz la interfaz más limpia y profesional.",
              timestamp: new Date(),
            },
            {
              id: "assistant-2",
              role: "assistant",
              content: "Preparé una dirección visual más minimalista para Codex.",
              timestamp: new Date(),
              agentRun: {
                summary: "Preparé una dirección visual más minimalista para Codex.",
                status: "done",
                steps: [],
                runId: "run-2",
                eventStream: [],
                error: null,
              },
            },
          ],
        },
        {
          id: "chat-1",
          stableKey: "chat-1",
          title: "Fix upload error",
          timestamp: Date.now() - 30 * 60 * 1000,
          messages: [
            {
              id: "user-1",
              role: "user",
              content: "Revisa el problema del upload y documenta el hotfix.",
              timestamp: new Date(),
            },
            {
              id: "assistant-1",
              role: "assistant",
              content: "El hotfix quedó listo y ya está validado.",
              timestamp: new Date(),
              agentRun: {
                summary: "El hotfix quedó listo y ya está validado.",
                status: "done",
                steps: [
                  {
                    stepIndex: 1,
                    toolName: "analyze-documents",
                    status: "complete",
                    output: "Se confirmó el origen del error en la ruta del análisis.",
                  },
                ],
                runId: "run-1",
                eventStream: [],
                error: null,
              },
            },
          ],
        },
      ],
      isLoading: false,
    });

    useProjectsMock.mockReturnValue({
      projects: [
        {
          id: "project-1",
          name: "Document hotfix",
          color: "#1f7a55",
          backgroundImage: null,
          systemPrompt: "",
          repositoryPath: "/workspace/hola",
          defaultCodeFolder: "main",
          codingAgents: ["coder"],
          files: [{ id: "file-1", name: "brief.md", type: "text/markdown", size: 128, source: "knowledge" }],
          chatIds: ["chat-1"],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      isLoading: false,
    });
  });

  it("renders the dedicated Codex workspace and opens the selected chat", () => {
    render(<CodexPage />);

    expect(screen.getByText("Todos los proyectos")).toBeInTheDocument();
    expect(screen.getByTestId("codex-session-title")).toHaveTextContent("Polish Codex screen");

    fireEvent.click(screen.getByTestId("codex-session-chat-1"));

    expect(screen.getByTestId("codex-session-title")).toHaveTextContent("Fix upload error");
    expect(screen.getAllByText("Document hotfix").length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace conectado")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("codex-open-chat"));

    expect(setLocationMock).toHaveBeenCalledWith("/chat/chat-1");
  });

  it("shows the empty workspace state when there are no sessions yet", () => {
    useChatsMock.mockReturnValue({
      allChats: [],
      isLoading: false,
    });

    useProjectsMock.mockReturnValue({
      projects: [],
      isLoading: false,
    });

    render(<CodexPage />);

    expect(screen.getByText("Nueva sesión lista para arrancar")).toBeInTheDocument();
    expect(screen.getByText("Abrir chat principal")).toBeInTheDocument();
  });
});

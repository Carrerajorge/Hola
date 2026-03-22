import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CodexPage from "@/pages/codex";

const setLocationMock = vi.fn();
const useAuthMock = vi.fn();
const useChatsMock = vi.fn();
const useProjectsMock = vi.fn();
const createCodexRunMock = vi.fn();
const spawnCodexSubagentsMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const addChatToProjectMock = vi.fn();
const apiFetchMock = vi.fn();
const loginMock = vi.fn();

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

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/services/codexRuntime", () => ({
  createCodexRun: (...args: unknown[]) => createCodexRunMock(...args),
  spawnCodexSubagents: (...args: unknown[]) => spawnCodexSubagentsMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe("CodexPage", () => {
  beforeEach(() => {
    setLocationMock.mockReset();
    useAuthMock.mockReset();
    useChatsMock.mockReset();
    useProjectsMock.mockReset();
    createCodexRunMock.mockReset();
    spawnCodexSubagentsMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    addChatToProjectMock.mockReset();
    apiFetchMock.mockReset();
    loginMock.mockReset();

    useAuthMock.mockReturnValue({
      user: {
        fullName: "Admin QA",
        email: "admin@example.com",
      },
      isAuthenticated: true,
      login: loginMock,
    });

    useChatsMock.mockReturnValue({
      allChats: [
        {
          id: "chat-2",
          stableKey: "chat-2",
          title: "Polish OpenClaw screen",
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
              content: "Preparé una dirección visual más minimalista para OpenClaw.",
              timestamp: new Date(),
              agentRun: {
                summary: "Preparé una dirección visual más minimalista para OpenClaw.",
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
      addChatToProject: addChatToProjectMock,
    });

    createCodexRunMock.mockResolvedValue({
      runId: "run-new",
      chatId: "chat-new",
      prompt: "prompt",
    });

    apiFetchMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url.startsWith("/api/openclaw/release?")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            requestedTag: "v2026.3.13-1",
            syncedAt: "2026-03-22T00:00:00.000Z",
            bundled: {
              version: "2026.3.13",
              matchesRequested: true,
            },
            requestedRelease: {
              tagName: "v2026.3.13-1",
              name: "openclaw 2026.3.13",
              htmlUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.3.13-1",
              tarballUrl: "https://api.github.com/repos/openclaw/openclaw/tarball/v2026.3.13-1",
              zipballUrl: "https://api.github.com/repos/openclaw/openclaw/zipball/v2026.3.13-1",
              publishedAt: "2026-03-14T18:04:28Z",
              overview: "Recovery release for the broken original tag.",
              importantNotes: ["The npm version remains 2026.3.13."],
              highlights: [
                "fix(compaction): use full-session token count",
                "fix(ui): keep shared auth on insecure control-ui connects",
              ],
              notes: "Full release notes",
              reactionCount: 346,
              isLatest: true,
            },
            latestRelease: {
              tagName: "v2026.3.13-1",
              name: "openclaw 2026.3.13",
              htmlUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.3.13-1",
              tarballUrl: "https://api.github.com/repos/openclaw/openclaw/tarball/v2026.3.13-1",
              zipballUrl: "https://api.github.com/repos/openclaw/openclaw/zipball/v2026.3.13-1",
              publishedAt: "2026-03-14T18:04:28Z",
              overview: "Recovery release for the broken original tag.",
              importantNotes: ["The npm version remains 2026.3.13."],
              highlights: ["fix(compaction): use full-session token count"],
              notes: "Full release notes",
              reactionCount: 346,
              isLatest: true,
            },
            sync: {
              status: "synced",
              summary: "OpenClaw v2026.3.13-1 is aligned with the latest release.",
              autoRefreshMinutes: 15,
              latestMatchesRequested: true,
            },
            errors: [],
          }),
        };
      }

      if (url === "/api/openclaw/stats") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 500,
            implemented: 438,
            partial: 22,
            stub: 31,
            missing: 9,
            coveragePercent: 92,
            gapCount: 40,
            gapsByCategory: {
              platform_messaging_ops_security: 14,
              local_ops_filesystem_devops: 11,
              documents_and_library: 8,
            },
          }),
        };
      }

      if (url.startsWith("/api/local/repo/branches?")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            branches: ["main", "codex/sidebar-compact-prod-20260321", "fix/document-upload-403-openclaw-fix"],
            current: "main",
            summary: {
              modifiedFiles: 185,
              insertions: 10354,
              deletions: 10397,
              label: "Sin confirmar: 185 archivos +10.354 -10.397",
            },
          }),
        };
      }

      if (url === "/api/local/repo/branches/switch" && options?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            branches: ["main", "codex/sidebar-compact-prod-20260321", "fix/document-upload-403-openclaw-fix"],
            current: "codex/sidebar-compact-prod-20260321",
            summary: {
              modifiedFiles: 40,
              insertions: 240,
              deletions: 12,
              label: "Sin confirmar: 40 archivos +240 -12",
            },
          }),
        };
      }

      if (url === "/api/local/repo/branches/create" && options?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            branches: ["main", "codex/nueva-tarea-20260321"],
            current: "codex/nueva-tarea-20260321",
            summary: {
              modifiedFiles: 0,
              insertions: 0,
              deletions: 0,
              label: "Sin cambios pendientes",
            },
          }),
        };
      }

      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    spawnCodexSubagentsMock.mockResolvedValue([
      {
        id: "subagent-1",
        requesterUserId: "user-1",
        objective: "Implementa la solucion",
        planHint: ["role:coder"],
        parentRunId: "run-new",
        status: "queued",
        createdAt: Date.now(),
      },
    ]);
  });

  it("renders the dedicated Codex workspace and opens the selected chat", async () => {
    render(<CodexPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/openclaw\/release\?/),
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/openclaw/stats",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/local/repo/branches?rootPath=%2Fworkspace%2Fhola",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    expect(screen.getByText("ILIAGPT")).toBeInTheDocument();
    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
    expect(screen.getAllByText("v2026.3.13-1").length).toBeGreaterThan(0);
    expect(screen.getByTestId("codex-session-title")).toHaveTextContent("Polish OpenClaw screen");
    expect(screen.getAllByText("/workspace/hola").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("codex-session-chat-1"));

    expect(screen.getByTestId("codex-session-title")).toHaveTextContent("Fix upload error");
    expect(screen.getAllByText("Document hotfix").length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace seguro")).toBeInTheDocument();
    expect(screen.getAllByText("92%").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("codex-open-chat"));

    expect(setLocationMock).toHaveBeenCalledWith("/chat/chat-1");
  });

  it("opens the branch picker from the main trigger", async () => {
    render(<CodexPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/local/repo/branches?rootPath=%2Fworkspace%2Fhola",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    fireEvent.click(screen.getByTestId("codex-branch-trigger"));

    expect(await screen.findByPlaceholderText("Buscar ramas")).toBeInTheDocument();
    expect(screen.getByText("Ramas")).toBeInTheDocument();
    expect(screen.getAllByText("main").length).toBeGreaterThan(1);
    expect(screen.getByText("codex/sidebar-compact-prod-20260321")).toBeInTheDocument();
    expect(screen.getByText("Crear y cambiar a una rama nueva...")).toBeInTheDocument();
  });

  it("shows the empty workspace state when there are no sessions yet", async () => {
    useChatsMock.mockReturnValue({
      allChats: [],
      isLoading: false,
    });

    useProjectsMock.mockReturnValue({
      projects: [],
      isLoading: false,
      addChatToProject: addChatToProjectMock,
    });

    render(<CodexPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/openclaw\/release\?/),
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    expect(screen.getByText("OpenClaw listo para mostrarse en tu plataforma")).toBeInTheDocument();
    expect(screen.getByText("Abrir chat principal")).toBeInTheDocument();
    expect(screen.getByText("Notas completas de la release")).toBeInTheDocument();
  });

  it("launches a real run with subagents and redirects to progress", async () => {
    render(<CodexPage />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Implementa el flujo completo de codificacion autonoma." },
    });

    fireEvent.click(screen.getByTestId("codex-launch-run"));

    await waitFor(() => {
      expect(createCodexRunMock).toHaveBeenCalledWith({
        chatId: null,
        message: "Implementa el flujo completo de codificacion autonoma.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        marathonMode: false,
      });
    });

    await waitFor(() => {
      expect(spawnCodexSubagentsMock).toHaveBeenCalledWith({
        runId: "run-new",
        message: "Implementa el flujo completo de codificacion autonoma.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        marathonMode: false,
        maxSubagents: 3,
      });
    });

    await waitFor(() => {
      expect(addChatToProjectMock).toHaveBeenCalledWith("chat-new", "project-1");
      expect(setLocationMock).toHaveBeenCalledWith("/runs/run-new/progress");
    });
  });

  it("shows the public preview mode and sends secure actions to login", async () => {
    useAuthMock.mockReturnValue({
      user: {
        id: "anon_preview",
        isAnonymous: true,
      },
      isAuthenticated: false,
      login: loginMock,
    });

    useChatsMock.mockReturnValue({
      allChats: [],
      isLoading: false,
    });

    useProjectsMock.mockReturnValue({
      projects: [],
      isLoading: false,
      addChatToProject: addChatToProjectMock,
    });

    render(<CodexPage />);

    expect(await screen.findByText("Vista previa abierta")).toBeInTheDocument();
    expect(screen.getAllByText("Entrar al workspace seguro").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /Entrar al workspace seguro/i })[0]!);

    expect(loginMock).toHaveBeenCalledTimes(1);
  });
});

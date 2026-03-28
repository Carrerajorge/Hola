import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENCLAW_RELEASE_TAG,
  OPENCLAW_RELEASE_VERSION,
} from "@shared/openclawRelease";

import {
  CODEX_RUN_RESUME_STORAGE_KEY,
  CODEX_WORKSPACE_DRAFT_STORAGE_KEY,
} from "@/lib/codexContinuity";
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
const localStorageState = new Map<string, string>();
const OPENCLAW_RELEASE_URL = `https://github.com/openclaw/openclaw/releases/tag/${DEFAULT_OPENCLAW_RELEASE_TAG}`;
const OPENCLAW_TARBALL_URL = `https://api.github.com/repos/openclaw/openclaw/tarball/${DEFAULT_OPENCLAW_RELEASE_TAG}`;
const OPENCLAW_ZIPBALL_URL = `https://api.github.com/repos/openclaw/openclaw/zipball/${DEFAULT_OPENCLAW_RELEASE_TAG}`;

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
  CODEX_EXECUTION_PROFILE_OPTIONS: [
    {
      value: "standard",
      label: "Estándar",
      shortLabel: "Normal",
      runtimeLabel: "Ventana estándar",
      checkpointLabel: "Cierre único al final",
      resilienceLabel: "Sin cadena prolongada",
    },
    {
      value: "marathon_12h",
      label: "Marathon 12h",
      shortLabel: "12h",
      runtimeLabel: "Cadena 12h",
      checkpointLabel: "Checkpoint cada entrega",
      resilienceLabel: "Replanificación extendida",
    },
    {
      value: "marathon_24h",
      label: "Marathon 24h",
      shortLabel: "24h",
      runtimeLabel: "Cadena 24h",
      checkpointLabel: "Checkpoint cada 60-90 min",
      resilienceLabel: "Auto-recuperación y handoff",
    },
  ],
  getCodexExecutionProfileOption: (profile: string) => {
    if (profile === "marathon_24h") {
      return {
        value: "marathon_24h",
        label: "Marathon 24h",
        shortLabel: "24h",
        runtimeLabel: "Cadena 24h",
        checkpointLabel: "Checkpoint cada 60-90 min",
        resilienceLabel: "Auto-recuperación y handoff",
      };
    }
    if (profile === "marathon_12h") {
      return {
        value: "marathon_12h",
        label: "Marathon 12h",
        shortLabel: "12h",
        runtimeLabel: "Cadena 12h",
        checkpointLabel: "Checkpoint cada entrega",
        resilienceLabel: "Replanificación extendida",
      };
    }
    return {
      value: "standard",
      label: "Estándar",
      shortLabel: "Normal",
      runtimeLabel: "Ventana estándar",
      checkpointLabel: "Cierre único al final",
      resilienceLabel: "Sin cadena prolongada",
    };
  },
  createCodexRun: (...args: unknown[]) => createCodexRunMock(...args),
  spawnCodexSubagents: (...args: unknown[]) => spawnCodexSubagentsMock(...args),
}));

vi.mock("@/lib/notify", () => ({
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
    window.localStorage.clear();

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
            requestedTag: DEFAULT_OPENCLAW_RELEASE_TAG,
            syncedAt: "2026-03-22T00:00:00.000Z",
            bundled: {
              version: OPENCLAW_RELEASE_VERSION,
              matchesRequested: true,
            },
            requestedRelease: {
              tagName: DEFAULT_OPENCLAW_RELEASE_TAG,
              name: `openclaw ${OPENCLAW_RELEASE_VERSION}`,
              htmlUrl: OPENCLAW_RELEASE_URL,
              tarballUrl: OPENCLAW_TARBALL_URL,
              zipballUrl: OPENCLAW_ZIPBALL_URL,
              publishedAt: "2026-03-23T11:11:00Z",
              overview: "Release with expanded native agent, sandbox, plugin, and control UI capabilities.",
              importantNotes: ["Breaking changes in plugin SDK, browser relay, and legacy env compatibility."],
              highlights: [
                "Sandbox runtime adds pluggable backends and SSH support",
                "Default OpenAI/Codex models move to GPT-5.4",
              ],
              notes: "Full release notes",
              reactionCount: 346,
              isLatest: true,
            },
            latestRelease: {
              tagName: DEFAULT_OPENCLAW_RELEASE_TAG,
              name: `openclaw ${OPENCLAW_RELEASE_VERSION}`,
              htmlUrl: OPENCLAW_RELEASE_URL,
              tarballUrl: OPENCLAW_TARBALL_URL,
              zipballUrl: OPENCLAW_ZIPBALL_URL,
              publishedAt: "2026-03-23T11:11:00Z",
              overview: "Release with expanded native agent, sandbox, plugin, and control UI capabilities.",
              importantNotes: ["Breaking changes in plugin SDK, browser relay, and legacy env compatibility."],
              highlights: ["Sandbox runtime adds pluggable backends and SSH support"],
              notes: "Full release notes",
              reactionCount: 346,
              isLatest: true,
            },
            sync: {
              status: "synced",
              summary: `OpenClaw ${DEFAULT_OPENCLAW_RELEASE_TAG} is aligned with the latest release.`,
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

      if (url === "/api/openclaw/runtime/health") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            timestamp: "2026-03-26T11:00:00.000Z",
            modules: {
              skills: true,
              tools: true,
              gateway: true,
            },
          }),
        };
      }

      if (url === "/api/openclaw/runtime/skills") {
        return {
          ok: true,
          json: async () => ({
            count: 48,
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
    expect(screen.getAllByText(DEFAULT_OPENCLAW_RELEASE_TAG).length).toBeGreaterThan(0);
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
        executionProfile: "standard",
        branchName: "main",
      });
    });

    await waitFor(() => {
      expect(spawnCodexSubagentsMock).toHaveBeenCalledWith({
        runId: "run-new",
        message: "Implementa el flujo completo de codificacion autonoma.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        executionProfile: "standard",
        maxSubagents: 3,
        branchName: "main",
      });
    });

    await waitFor(() => {
      expect(addChatToProjectMock).toHaveBeenCalledWith("chat-new", "project-1");
      expect(setLocationMock).toHaveBeenCalledWith("/runs/run-new/progress");
    });
  });

  it("launches the run when pressing Enter in the Codex composer", async () => {
    render(<CodexPage />);

    const composer = screen.getByRole("textbox");

    fireEvent.change(composer, {
      target: { value: "Lanza este run con Enter." },
    });

    fireEvent.keyDown(composer, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => {
      expect(createCodexRunMock).toHaveBeenCalledWith({
        chatId: null,
        message: "Lanza este run con Enter.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        executionProfile: "standard",
        branchName: "main",
      });
    });
  });

  it("keeps Shift+Enter for multiline input without launching", () => {
    render(<CodexPage />);

    const composer = screen.getByRole("textbox");

    fireEvent.change(composer, {
      target: { value: "Primera linea" },
    });

    fireEvent.keyDown(composer, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
      shiftKey: true,
    });

    expect(createCodexRunMock).not.toHaveBeenCalled();
  });

  it("cycles the execution profile up to 24h and launches with that profile", async () => {
    render(<CodexPage />);

    fireEvent.click(screen.getByTestId("codex-marathon-toggle"));
    fireEvent.click(screen.getByTestId("codex-marathon-toggle"));

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Mantén una cadena de programación muy larga con checkpoints." },
    });

    fireEvent.click(screen.getByTestId("codex-launch-run"));

    await waitFor(() => {
      expect(createCodexRunMock).toHaveBeenCalledWith({
        chatId: null,
        message: "Mantén una cadena de programación muy larga con checkpoints.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        executionProfile: "marathon_24h",
        branchName: "main",
      });
    });

    await waitFor(() => {
      expect(spawnCodexSubagentsMock).toHaveBeenCalledWith({
        runId: "run-new",
        message: "Mantén una cadena de programación muy larga con checkpoints.",
        project: expect.objectContaining({ id: "project-1", name: "Document hotfix" }),
        executionProfile: "marathon_24h",
        maxSubagents: 3,
        branchName: "main",
      });
    });
  });

  it("rehydrates the long-run workspace state and offers a direct resume entrypoint", async () => {
    window.localStorage.setItem(
      CODEX_WORKSPACE_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        draft: "Retoma la cadena 24h con foco en checkpoints y validación.",
        multiAgentEnabled: false,
        executionProfile: "marathon_24h",
        maxSubagents: 4,
        selectedProjectId: "project-1",
        selectedSessionId: "chat-1",
        activeRepoBranch: "fix/document-upload-403-openclaw-fix",
        activeView: "workspace",
      }),
    );
    window.localStorage.setItem(
      CODEX_RUN_RESUME_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        runId: "run-marathon",
        chatId: "chat-1",
        executionProfile: "marathon_24h",
        status: "running",
        summary: "Retomar run largo",
        objective: "Retoma la cadena 24h con foco en checkpoints y validación.",
        lastEventTitle: "Checkpoint listo: integración y smoke test parciales.",
        updatedAt: Date.now(),
      }),
    );

    render(<CodexPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/local/repo/branches?rootPath=%2Fworkspace%2Fhola",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    expect(screen.getByRole("textbox")).toHaveValue(
      "Retoma la cadena 24h con foco en checkpoints y validación.",
    );
    expect(screen.getByTestId("codex-session-title")).toHaveTextContent("Fix upload error");
    expect(screen.getByText("Reanudación fuerte")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint listo: integración y smoke test parciales.")).toBeInTheDocument();
    expect(screen.getByTestId("codex-launch-run")).toHaveTextContent("Lanzar 24h");
    expect(screen.getByTestId("codex-branch-trigger")).toHaveTextContent("fix/document-upload-403-openclaw-fix");

    fireEvent.click(screen.getByTestId("codex-resume-run"));

    expect(setLocationMock).toHaveBeenCalledWith("/runs/run-marathon/progress");
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

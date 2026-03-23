import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog";

const {
  apiFetchMock,
  authState,
  loginMock,
  logoutMock,
  updateSettingMock,
  onOpenChangeMock,
  toastMock,
  settingsState,
} = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  authState: {
    user: {
      id: "user_1",
      fullName: "Usuario QA",
      username: "usuarioqa",
      email: "qa@example.com",
    },
    isAuthenticated: true,
  },
  loginMock: vi.fn(),
  logoutMock: vi.fn(),
  updateSettingMock: vi.fn(),
  onOpenChangeMock: vi.fn(),
  toastMock: vi.fn(),
  settingsState: {
    appearance: "light",
    accentColor: "default",
    fontSize: "medium",
    density: "comfortable",
    spokenLanguage: "auto",
    timeFormat: "24h",
    voice: "cove",
    autoPlayResponses: false,
    independentVoiceMode: false,
    defaultModel: "",
    showAdditionalModels: true,
    streamResponses: true,
    keyboardShortcuts: true,
    reducedMotion: false,
    highContrast: false,
    styleAndTone: "default",
    customInstructions: "",
    nickname: "",
    occupation: "",
    aboutYou: "",
    allowMemories: true,
    allowRecordings: false,
    webSearch: true,
    codeInterpreter: true,
    canvas: true,
    voiceMode: true,
    advancedVoice: false,
    connectorSearch: false,
    authApp: false,
    pushNotifications: false,
    showName: true,
    websiteDomain: "",
    linkedInUrl: "",
    githubUrl: "",
    receiveEmailComments: false,
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: authState.user,
    isAuthenticated: authState.isAuthenticated,
    login: loginMock,
    logout: logoutMock,
  }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettingsContext: () => ({
    settings: settingsState,
    updateSetting: updateSettingMock,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    syncSettingsToServer: vi.fn(),
    loadSettingsFromServer: vi.fn(),
    isSyncing: false,
    isAuthenticated: true,
  }),
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      theme_mode: "auto",
      date_format: "YYYY-MM-DD",
      timezone_default: "UTC",
      default_model: "z.ai/glm-5",
      enable_streaming: true,
    },
  }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "es",
    setLanguage: vi.fn(),
    supportedLanguages: [
      { code: "es", name: "Español (Spanish)" },
      { code: "en", name: "English" },
    ],
  }),
}));

vi.mock("@/contexts/ModelAvailabilityContext", () => ({
  useModelAvailability: () => ({
    availableModels: [
      {
        id: "model_1",
        modelId: "z.ai/glm-5",
        name: "Z.ai GLM 5",
        provider: "zai",
      },
    ],
  }),
}));

vi.mock("@/components/schedules-manager-dialog", () => ({
  SchedulesManagerDialog: () => null,
}));

vi.mock("@/components/sessions-manager-dialog", () => ({
  SessionsManagerDialog: () => null,
}));

vi.mock("@/components/settings/notifications-control-panels", () => ({
  NotificationsControlPanels: () => (
    <div>
      <h2>Preferencias de Notificaciones</h2>
      <p>Configura cómo y cuándo recibir notificaciones</p>
    </div>
  ),
}));

vi.mock("file-saver", () => ({
  saveAs: vi.fn(),
}));

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog open={true} onOpenChange={onOpenChangeMock} />
    </QueryClientProvider>,
  );
}

describe("SettingsDialog navigation", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
    updateSettingMock.mockReset();
    onOpenChangeMock.mockReset();
    toastMock.mockReset();
    authState.user = {
      id: "user_1",
      fullName: "Usuario QA",
      username: "usuarioqa",
      email: "qa@example.com",
    };
    authState.isAuthenticated = true;

    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/users/user_1/integrations") {
        return jsonResponse({
          accounts: [],
          providers: [],
          policy: {
            enabledApps: [],
            autoConfirmPolicy: "ask",
            sandboxMode: "false",
            maxParallelCalls: 3,
          },
        });
      }

      if (url === "/api/users/user_1/integrations/logs?limit=10") {
        return jsonResponse([]);
      }

      if (url === "/api/users/user_1/privacy") {
        return jsonResponse({
          privacySettings: {
            trainingOptIn: false,
            remoteBrowserDataAccess: false,
            analyticsTracking: true,
            chatHistoryEnabled: true,
          },
          consentHistory: [],
        });
      }

      if (url === "/api/users/user_1/shared-links") {
        return jsonResponse([]);
      }

      if (url === "/api/users/user_1/chats/archived") {
        return jsonResponse([]);
      }

      if (url === "/api/users/user_1/chats/deleted") {
        return jsonResponse([]);
      }

      if (url === "/api/users/user_1/schedules") {
        return jsonResponse([
          {
            id: "schedule_1",
            chatId: "chat_1",
            chatTitle: "Recordatorios",
            name: "Resumen diario",
            prompt: "Enviar resumen",
            scheduleType: "daily",
            timeZone: "UTC",
            isActive: true,
            nextRunAt: "2026-03-24T09:00:00.000Z",
            lastRunAt: "2026-03-23T09:00:00.000Z",
            failureCount: 0,
            lastError: null,
            createdAt: "2026-03-20T09:00:00.000Z",
            updatedAt: "2026-03-23T09:00:00.000Z",
          },
        ]);
      }

      if (url === "/api/security/trusted-devices") {
        return jsonResponse({ currentSid: "sid_current", devices: [] });
      }

      if (url === "/api/2fa/status") {
        return jsonResponse({ enabled: false, verified: false });
      }

      return jsonResponse({});
    });
  });

  it("opens the expected content for each settings menu button", async () => {
    renderDialog();

    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();

    const sections = [
      { testId: "settings-menu-notifications", heading: "Preferencias de Notificaciones" },
      { testId: "settings-menu-personalization", heading: "Personalización" },
      { testId: "settings-menu-apps", heading: "Aplicaciones e Integraciones" },
      { testId: "settings-menu-schedules", heading: "Programaciones" },
      { testId: "settings-menu-data", heading: "Controles de datos" },
      { testId: "settings-menu-security", heading: "Seguridad" },
      { testId: "settings-menu-account", heading: "Perfil de constructor de GPT" },
    ] as const;

    for (const section of sections) {
      fireEvent.click(screen.getByTestId(section.testId));
      expect(await screen.findByRole("heading", { name: section.heading })).toBeInTheDocument();
    }
  });

  it("shows sign-in guidance for blocked sections when the user is anonymous", async () => {
    authState.user = {
      id: "anon_1",
      username: "Guest-anon",
      email: undefined,
    };
    authState.isAuthenticated = false;

    renderDialog();

    fireEvent.click(screen.getByTestId("settings-menu-apps"));
    expect(await screen.findByTestId("card-integrations-signin-required")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-menu-schedules"));
    expect(await screen.findByTestId("card-schedules-signin-required")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-menu-data"));
    expect(await screen.findByTestId("card-data-controls-signin-required")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("settings-menu-security"));
    expect(await screen.findByTestId("card-security-signin-required")).toBeInTheDocument();
    expect(screen.getByTestId("switch-auth-app")).toBeDisabled();
    expect(screen.getByTestId("switch-push-notif")).toBeDisabled();
    expect(screen.getByTestId("security-trusted-devices")).toBeDisabled();
    expect(screen.getByTestId("button-logout-all")).toBeDisabled();

    fireEvent.click(screen.getByTestId("settings-menu-account"));
    expect(await screen.findByTestId("card-account-signin-required")).toBeInTheDocument();
  });

  it("shows schedule summary cards and the next run when schedules exist", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("settings-menu-schedules"));

    expect(await screen.findByTestId("card-schedules-total")).toHaveTextContent("1");
    expect(screen.getByTestId("card-schedules-active")).toHaveTextContent("1");
    expect(screen.getByTestId("card-schedules-next-run")).toHaveTextContent("2026-03-24 09:00");
    expect(screen.getByTestId("card-schedule-preview-schedule_1")).toHaveTextContent("Resumen diario");
  });

  it("renders clearer admin-managed badges in general settings", async () => {
    renderDialog();

    expect(await screen.findByTestId("badge-admin-managed-date-format")).toBeInTheDocument();
    expect(screen.getByTestId("badge-admin-managed-timezone")).toBeInTheDocument();
  });

  it("shows helpful empty states in account when links or email are missing", async () => {
    authState.user = {
      id: "user_1",
      fullName: "Usuario QA",
      username: "usuarioqa",
      email: undefined,
    };

    renderDialog();

    fireEvent.click(screen.getByTestId("settings-menu-account"));

    expect(await screen.findByTestId("card-account-links-empty")).toBeInTheDocument();
    expect(screen.getByTestId("text-account-email-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-email-comments")).toBeDisabled();
  });
});

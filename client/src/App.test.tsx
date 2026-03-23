import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalKeyboardShortcuts, shouldEnableGlobalKeyboardShortcuts } from "@/App";

const {
  setLocationMock,
  useChatsMock,
  useKeyboardShortcutsMock,
  authState,
  routerState,
} = vi.hoisted(() => ({
  setLocationMock: vi.fn(),
  useChatsMock: vi.fn(() => ({ chats: [] })),
  useKeyboardShortcutsMock: vi.fn(),
  authState: {
    isAuthenticated: false,
    isReady: true,
    user: null,
  },
  routerState: {
    location: "/login",
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => [routerState.location, setLocationMock],
  Switch: ({ children }: { children: unknown }) => children,
  Route: ({ children }: { children: unknown }) => children,
  useParams: () => ({}),
}));

vi.mock("@/hooks/use-auth", () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => authState,
}));

vi.mock("@/hooks/use-chats", () => ({
  useChats: () => useChatsMock(),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  SettingsProvider: ({ children }: { children: unknown }) => children,
  useSettingsContext: () => ({
    settings: {
      keyboardShortcuts: true,
    },
  }),
}));

vi.mock("@/contexts/ModelAvailabilityContext", () => ({
  ModelAvailabilityProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  PlatformSettingsProvider: ({ children }: { children: unknown }) => children,
  usePlatformSettings: () => ({
    settings: {
      maintenance_mode: false,
      allow_during_maintenance: false,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: (...args: unknown[]) => useKeyboardShortcutsMock(...args),
}));

vi.mock("@/components/search-modal", () => ({
  SearchModal: () => null,
}));

vi.mock("@/components/tool-catalog", () => ({
  ToolCatalog: () => null,
}));

vi.mock("@/components/command-palette", () => ({
  CommandPalette: () => null,
}));

vi.mock("@/components/modals/KeyboardShortcutsModal", () => ({
  KeyboardShortcutsModal: () => null,
}));

describe("GlobalKeyboardShortcuts", () => {
  beforeEach(() => {
    setLocationMock.mockReset();
    useChatsMock.mockClear();
    useKeyboardShortcutsMock.mockClear();
    authState.isAuthenticated = false;
    authState.user = null;
    routerState.location = "/login";
  });

  it("does not mount chat state on login when the user is not authenticated", () => {
    render(<GlobalKeyboardShortcuts />);

    expect(useChatsMock).not.toHaveBeenCalled();
    expect(useKeyboardShortcutsMock).not.toHaveBeenCalled();
  });

  it("keeps shortcuts available in the public openclaw preview", () => {
    routerState.location = "/openclaw";

    render(<GlobalKeyboardShortcuts />);

    expect(useChatsMock).toHaveBeenCalledTimes(1);
    expect(useKeyboardShortcutsMock).toHaveBeenCalledTimes(1);
  });

  it("enables shortcuts on the authenticated root workspace", () => {
    routerState.location = "/";
    authState.isAuthenticated = true;
    authState.user = { id: "user_123" };

    render(<GlobalKeyboardShortcuts />);

    expect(useChatsMock).toHaveBeenCalledTimes(1);
  });
});

describe("shouldEnableGlobalKeyboardShortcuts", () => {
  it("only enables public guest shortcuts for openclaw", () => {
    expect(shouldEnableGlobalKeyboardShortcuts("/login", false)).toBe(false);
    expect(shouldEnableGlobalKeyboardShortcuts("/openclaw", false)).toBe(true);
    expect(shouldEnableGlobalKeyboardShortcuts("/", true)).toBe(true);
  });
});

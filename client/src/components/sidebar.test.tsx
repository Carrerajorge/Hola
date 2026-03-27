import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/sidebar";
import type { Chat } from "@/hooks/use-chats";

const {
  logoutMock,
  setLocationMock,
  unpinGptMock,
  createProjectMock,
  deleteProjectMock,
  updateProjectMock,
  addChatToProjectMock,
  getProjectForChatMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  setLocationMock: vi.fn(),
  unpinGptMock: vi.fn(),
  createProjectMock: vi.fn(),
  deleteProjectMock: vi.fn(),
  updateProjectMock: vi.fn(),
  addChatToProjectMock: vi.fn(),
  getProjectForChatMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", setLocationMock],
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user_sidebar",
      fullName: "Usuario Sidebar",
      username: "sidebar",
      email: "sidebar@example.com",
    },
    logout: logoutMock,
  }),
}));

vi.mock("@/hooks/use-pinned-gpts", () => ({
  usePinnedGpts: () => ({
    pinnedGpts: [],
    unpinGpt: unpinGptMock,
  }),
}));

vi.mock("@/hooks/use-whatsapp-web", () => ({
  useWhatsAppWebStatus: () => ({
    status: { state: "disconnected" },
  }),
}));

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({
    projects: [],
    createProject: createProjectMock,
    deleteProject: deleteProjectMock,
    updateProject: updateProjectMock,
    addChatToProject: addChatToProjectMock,
    getProjectForChat: getProjectForChatMock,
  }),
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      timezone_default: "UTC",
      date_format: "YYYY-MM-DD",
      app_name: "ILIAGPT",
      app_description: "AI Platform",
      maintenance_mode: false,
    },
  }),
}));

vi.mock("@/lib/notify", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/stores/streamingStore", () => ({
  useProcessingChatIds: () => [],
  useChatStreamContent: () => "",
}));

vi.mock("@/components/search-modal", () => ({
  SearchModal: () => null,
}));

vi.mock("@/components/settings-dialog", () => ({
  SettingsDialog: () => null,
}));

vi.mock("@/components/create-project-modal", () => ({
  CreateProjectModal: () => null,
}));

vi.mock("@/components/edit-project-modal", () => ({
  EditProjectModal: () => null,
}));

vi.mock("@/components/project-memories-modal", () => ({
  ProjectMemoriesModal: () => null,
}));

vi.mock("@/components/share-project-modal", () => ({
  ShareProjectModal: () => null,
}));

vi.mock("@/components/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));

const chats: Chat[] = [
  {
    id: "chat_sidebar_1",
    stableKey: "chat_sidebar_1",
    title: "Primer chat",
    timestamp: Date.now(),
    messages: [],
  },
];

describe("Sidebar primary action spacing", () => {
  it("keeps search flush with the rest of the primary navigation stack", () => {
    createProjectMock.mockResolvedValue({
      id: "project-sidebar",
      name: "Desktop",
      color: "#3b82f6",
      backgroundImage: null,
      systemPrompt: "",
      repositoryPath: "/Users/luis/Desktop",
      defaultCodeFolder: ".",
      codingAgents: ["coder"],
      files: [],
      chatIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    render(
      <Sidebar
        chats={chats}
        activeChatId={null}
        onSelectChat={vi.fn()}
      />,
    );

    const searchButton = screen.getByTestId("button-search-chats");
    const primaryActionStack = searchButton.parentElement;
    const navigationGroup = searchButton.nextElementSibling as HTMLElement | null;

    expect(searchButton.className).not.toMatch(/\bmt-[^\s"]+/);
    expect(searchButton.className).not.toMatch(/\bmb-[^\s"]+/);

    expect(primaryActionStack).toHaveClass("flex", "flex-col", "gap-0.5");
    expect(navigationGroup).toHaveClass("flex", "flex-col", "gap-0.5");
    expect(screen.getByTestId("button-library").parentElement).toBe(navigationGroup);
    expect(screen.getByTestId("button-gpts").parentElement).toBe(navigationGroup);
    expect(screen.getByText("Hilos")).toBeInTheDocument();
    expect(screen.getByTestId("button-thread-controls")).toBeInTheDocument();
    expect(screen.getByTestId("button-new-folder")).toBeInTheDocument();
  });

  it("creates and selects a local project from Nueva Carpeta", async () => {
    const onSelectProject = vi.fn();
    Object.defineProperty(window, "electronAPI", {
      value: {
        pickWorkspaceFolder: vi.fn().mockResolvedValue("/Users/luis/Desktop/WorkspaceLocal"),
      },
      configurable: true,
    });

    createProjectMock.mockResolvedValue({
      id: "project-local",
      name: "WorkspaceLocal",
      color: "#3b82f6",
      backgroundImage: null,
      systemPrompt: "",
      repositoryPath: "/Users/luis/Desktop/WorkspaceLocal",
      defaultCodeFolder: ".",
      codingAgents: ["coder"],
      files: [],
      chatIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    render(
      <Sidebar
        chats={chats}
        activeChatId={null}
        onSelectChat={vi.fn()}
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByTestId("button-new-folder"));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "WorkspaceLocal",
          repositoryPath: "/Users/luis/Desktop/WorkspaceLocal",
          defaultCodeFolder: ".",
        }),
      );
    });

    await waitFor(() => {
      expect(onSelectProject).toHaveBeenCalledWith("project-local");
      expect(toastSuccessMock).toHaveBeenCalled();
    });
  });
});

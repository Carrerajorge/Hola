import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSettingsPage from "@/pages/workspace-settings";

const setLocationMock = vi.fn();
const apiFetchMock = vi.fn();
const toastMock = vi.fn();
const trackWorkspaceEventMock = vi.fn().mockResolvedValue(undefined);

let mockSearchString = "";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

vi.mock("wouter", () => ({
  useLocation: () => ["/workspace-settings", setLocationMock],
  useSearch: () => mockSearchString,
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackWorkspaceEvent: (...args: unknown[]) => trackWorkspaceEventMock(...args),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: () => false,
}));

vi.mock("@/hooks/use-cloud-library", () => ({
  useCloudLibrary: () => ({
    uploadFile: vi.fn(),
    isUploading: false,
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user_1",
      fullName: "Jorge Carrera",
      username: "jorge",
      email: "jorge@example.com",
    },
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/components/upgrade-plan-dialog", () => ({
  UpgradePlanDialog: () => null,
}));

vi.mock("@/components/credit-alerts-dialog", () => ({
  CreditAlertsDialog: () => null,
}));

vi.mock("@/components/workspace-settings/IdentityAccessSection", () => ({
  IdentityAccessSection: () => <div>Identidad</div>,
}));

vi.mock("@/components/workspace-settings/WorkspaceGroupsSection", () => ({
  WorkspaceGroupsSection: () => <div>Grupos</div>,
}));

describe("WorkspaceSettingsPage navigation", () => {
  beforeEach(() => {
    mockSearchString = "";
    setLocationMock.mockReset();
    apiFetchMock.mockReset();
    toastMock.mockReset();
    trackWorkspaceEventMock.mockClear();

    apiFetchMock.mockImplementation((url: string) => {
      if (url === "/api/billing/status") {
        return jsonResponse({
          subscriptionStatus: null,
          subscriptionPeriodEnd: null,
        });
      }

      if (url === "/api/workspace/me") {
        return jsonResponse({
          orgId: "org_123",
          workspaceId: "ws_123",
          name: "Espacio QA",
          logoFileUuid: null,
          memberCount: 3,
          canManageWorkspace: true,
          canManageMembers: true,
          canManageRoles: true,
          canManageBilling: true,
        });
      }

      if (String(url).startsWith("/api/billing/credits/usage")) {
        return jsonResponse({
          cycleStart: "2026-03-01",
          cycleEnd: "2026-03-31",
          plan: "pro",
          totalTokens: 0,
          totalRequests: 0,
          limitTokens: null,
          percentUsed: null,
        });
      }

      if (String(url).startsWith("/api/billing/invoices")) {
        return jsonResponse({
          invoices: [],
          hasMore: false,
          nextCursor: null,
        });
      }

      if (url === "/api/workspace/members") {
        return jsonResponse({ members: [] });
      }

      if (url === "/api/workspace/roles") {
        return jsonResponse({
          roles: [
            {
              id: "role_1",
              roleKey: "team_member",
              name: "Miembro",
              description: null,
              permissions: [],
              isCustom: false,
              isEditable: false,
            },
          ],
          permissions: [],
        });
      }

      if (url === "/api/workspace/invitations?status=pending") {
        return jsonResponse({ invitations: [] });
      }

      return jsonResponse({});
    });
  });

  it("navigates to sidebar sections and back to chat", async () => {
    render(<WorkspaceSettingsPage />);

    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(await screen.findByText("Espacio QA")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-menu-members"));

    expect(setLocationMock).toHaveBeenCalledWith("/workspace-settings?section=members&membersTab=users");
    expect(await screen.findByRole("heading", { name: "Miembros" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-back-to-chat"));

    expect(setLocationMock).toHaveBeenLastCalledWith("/");
  });

  it("uses the current section from the URL and lets the workspace header return to general", async () => {
    mockSearchString = "section=billing";

    render(<WorkspaceSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Facturación" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("workspace-menu-home"));

    expect(setLocationMock).toHaveBeenCalledWith("/workspace-settings?section=general");
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
  });

  it("falls back to general when the section query disappears", async () => {
    mockSearchString = "section=billing";

    const { rerender } = render(<WorkspaceSettingsPage />);

    expect(await screen.findByRole("heading", { name: "Facturación" })).toBeInTheDocument();

    mockSearchString = "";
    rerender(<WorkspaceSettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    });
  });

  it("filters the permissions view and keeps advanced switches read-only", async () => {
    render(<WorkspaceSettingsPage />);

    fireEvent.click(await screen.findByTestId("workspace-menu-permissions"));

    expect(await screen.findByRole("heading", { name: "Permisos y roles" })).toBeInTheDocument();
    expect(screen.getByText("Modo solo vista")).toBeInTheDocument();

    const searchInput = screen.getByTestId("input-search-permissions");
    fireEvent.change(searchInput, { target: { value: "canvas" } });

    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.queryByText("Memoria")).not.toBeInTheDocument();
    expect(screen.getByTestId("switch-canvas-code")).toBeDisabled();
  });

  it("shows the GPT catalog as preview with working search and read-only controls", async () => {
    render(<WorkspaceSettingsPage />);

    fireEvent.click(await screen.findByTestId("workspace-menu-gpt"));

    expect(await screen.findByText("Vista previa del catálogo")).toBeInTheDocument();
    expect(screen.getByText("Vista previa del catálogo")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-gpt-search"), { target: { value: "justificación" } });

    expect(screen.getByText("1.6. - Justificación")).toBeInTheDocument();
    expect(screen.queryByText("BASES TEORICAS")).not.toBeInTheDocument();
    expect(screen.getByTestId("checkbox-allow-domains")).toBeDisabled();
  });

  it("shows the apps catalog as preview with working search and disabled create actions", async () => {
    render(<WorkspaceSettingsPage />);

    fireEvent.click(await screen.findByTestId("workspace-menu-apps"));

    expect(await screen.findByRole("heading", { name: "Aplicaciones" })).toBeInTheDocument();
    expect(screen.getByText("Vista previa del directorio")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-apps-search"), { target: { value: "github" } });

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Adobe Acrobat")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-apps-create")).toBeDisabled();
    expect(screen.getByTestId("checkbox-apps-all")).toBeDisabled();
  });

  it("restores the members tab from the URL and syncs tab changes back to the query", async () => {
    mockSearchString = "section=members&membersTab=pending-invites";

    render(<WorkspaceSettingsPage />);

    expect(await screen.findByText("No hay invitaciones pendientes.")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("tab-users"), { button: 0 });

    expect(setLocationMock).toHaveBeenLastCalledWith("/workspace-settings?section=members&membersTab=users");
  });

  it("restores the billing tab from the URL and keeps invoice navigation shareable", async () => {
    mockSearchString = "section=billing&billingTab=invoices";

    render(<WorkspaceSettingsPage />);

    expect(await screen.findByText("No hay facturas disponibles.")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("tab-billing-plan"), { button: 0 });

    expect(setLocationMock).toHaveBeenLastCalledWith("/workspace-settings?section=billing&billingTab=plan");
  });

  it("restores GPT and apps tabs from the URL and syncs their tab changes", async () => {
    mockSearchString = "section=gpt&gptTab=unassigned";

    const { rerender } = render(<WorkspaceSettingsPage />);

    expect(await screen.findByText("No hay GPTs sin asignar")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("tab-gpt-workspace"), { button: 0 });

    expect(setLocationMock).toHaveBeenLastCalledWith("/workspace-settings?section=gpt&gptTab=workspace");

    mockSearchString = "section=apps&appsTab=directory";
    rerender(<WorkspaceSettingsPage />);

    expect(await screen.findByText("Explora el directorio de aplicaciones disponibles")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("tab-apps-drafts"), { button: 0 });

    expect(setLocationMock).toHaveBeenLastCalledWith("/workspace-settings?section=apps&appsTab=drafts");
  });
});

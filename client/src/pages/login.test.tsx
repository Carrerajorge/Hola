import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/login";

const setLocationMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/login", setLocationMock],
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      app_name: "ILIAGPT",
      allow_registration: true,
      support_email: "",
    },
  }),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/lib/auth-flow", () => ({
  clearForcedSignedOutFlag: vi.fn(),
}));

describe("LoginPage", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    setLocationMock.mockReset();
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("shows Google as the only active branded social login option", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/mfa/status");
    });

    expect(screen.getByTestId("button-login-google")).toBeVisible();
    expect(screen.queryByTestId("button-login-openai")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-login-gemini")).not.toBeInTheDocument();
    expect(screen.getAllByText("Próximamente")).toHaveLength(2);
    expect(screen.getByText("Continuar con Apple")).toBeVisible();
    expect(screen.getByText("Continuar con Microsoft")).toBeVisible();
  });
});

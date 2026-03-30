import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import LoginPage from "@/pages/login";

const setLocationMock = vi.fn();
const apiFetchMock = vi.fn();
const locationAssignMock = vi.fn();
const originalLocation = window.location;

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
  beforeAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: locationAssignMock,
        href: "http://localhost/login",
        origin: "http://localhost",
        pathname: "/login",
        search: "",
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  beforeEach(() => {
    apiFetchMock.mockReset();
    setLocationMock.mockReset();
    locationAssignMock.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: locationAssignMock,
        href: "http://localhost/login",
        origin: "http://localhost",
        pathname: "/login",
        search: "",
      },
    });
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ active: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("shows the branded social login options", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/mfa/status");
    });

    expect(screen.getByTestId("button-login-google")).toBeVisible();
    expect(screen.getByTestId("button-login-openai")).toBeVisible();
    expect(screen.getByTestId("button-login-gemini")).toBeVisible();
    expect(screen.getByTestId("button-login-apple")).toBeVisible();
    expect(screen.getByTestId("button-login-microsoft")).toBeVisible();
    expect(screen.getByText("Continuar con Apple")).toBeVisible();
    expect(screen.getByText("Continuar con Microsoft")).toBeVisible();
  });

  it("only shows loading state on the selected social provider", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/mfa/status");
    });

    const googleButton = screen.getByTestId("button-login-google");
    const openAiButton = screen.getByTestId("button-login-openai");
    const geminiButton = screen.getByTestId("button-login-gemini");

    fireEvent.click(openAiButton);

    expect(locationAssignMock).toHaveBeenCalledWith("/api/auth/google?provider_hint=openai");
    expect(openAiButton).toHaveTextContent("Conectando...");
    expect(googleButton).toHaveTextContent("Continuar con Google");
    expect(geminiButton).toHaveTextContent("Continuar con Gemini");
  });

  it("renders specific Google OAuth errors from the callback query params", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: locationAssignMock,
        href: "http://localhost/login?error=google_not_configured&message=redirect_uri_mismatch",
        origin: "http://localhost",
        pathname: "/login",
        search: "?error=google_not_configured&message=redirect_uri_mismatch",
      },
    });

    render(<LoginPage />);

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith("/api/auth/mfa/status");
    });

    expect(
      screen.getByText(
        "El inicio de sesión con Google no está configurado en este entorno. redirect_uri_mismatch"
      )
    ).toBeVisible();
  });
});

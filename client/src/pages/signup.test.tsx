import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignupPage from "@/pages/signup";

const setLocationMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/signup", setLocationMock],
}));

vi.mock("@/contexts/PlatformSettingsContext", () => ({
  usePlatformSettings: () => ({
    settings: {
      allow_registration: true,
      support_email: "",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock("@/lib/auth-flow", () => ({
  clearForcedSignedOutFlag: vi.fn(),
}));

describe("SignupPage", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    setLocationMock.mockReset();
  });

  it("registers a new user before redirecting to login", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true, message: "Cuenta creada correctamente" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(<SignupPage />);

    fireEvent.change(screen.getByTestId("input-signup-email-initial"), {
      target: { value: "codex-signup@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-signup-continue"));

    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "VeryStrongPass123!" },
    });
    fireEvent.change(screen.getByTestId("input-signup-confirm-password"), {
      target: { value: "VeryStrongPass123!" },
    });
    fireEvent.click(screen.getByTestId("button-create-account"));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/auth/register",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "codex-signup@example.com",
            password: "VeryStrongPass123!",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(setLocationMock).toHaveBeenCalledWith("/login?email=codex-signup%40example.com");
    });
  });

  it("shows the backend error when registration fails", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "El usuario ya existe" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(<SignupPage />);

    fireEvent.change(screen.getByTestId("input-signup-email-initial"), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByTestId("button-signup-continue"));

    fireEvent.change(screen.getByTestId("input-signup-password"), {
      target: { value: "VeryStrongPass123!" },
    });
    fireEvent.change(screen.getByTestId("input-signup-confirm-password"), {
      target: { value: "VeryStrongPass123!" },
    });
    fireEvent.click(screen.getByTestId("button-create-account"));

    await waitFor(() => {
      expect(screen.getByTestId("text-signup-error")).toHaveTextContent("El usuario ya existe");
    });
    expect(setLocationMock).not.toHaveBeenCalled();
  });
});

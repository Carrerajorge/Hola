import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProviderConnectionHubButton } from "./ProviderConnectionHubButton";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-provider-oauth", () => ({
  useAllProvidersStatus: () => ({
    data: {
      providers: {
        anthropic: { connected: false },
      },
    },
    refetch: vi.fn(async () => ({})),
  }),
  useAnthropicKeySubmit: () => ({
    mutateAsync: vi.fn(async () => ({ success: true })),
    isPending: false,
    error: null,
  }),
  useProviderDisconnect: () => ({
    mutateAsync: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock("./OpenAICodexOAuthButton", () => ({
  OpenAICodexOAuthButton: ({
    renderTrigger,
  }: {
    renderTrigger: (state: {
      isBusy: boolean;
      isConnected: boolean;
      openDialog: () => void;
    }) => ReactNode;
  }) => <>{renderTrigger({ isBusy: false, isConnected: false, openDialog: vi.fn() })}</>,
}));

vi.mock("./GeminiCliOAuthButton", () => ({
  GeminiCliOAuthButton: ({
    renderTrigger,
  }: {
    renderTrigger: (state: {
      isBusy: boolean;
      isConnected: boolean;
      openDialog: () => void;
    }) => ReactNode;
  }) => <>{renderTrigger({ isBusy: false, isConnected: false, openDialog: vi.fn() })}</>,
}));

vi.mock("./OAuthProviderLogos", () => ({
  AntigravityLogoIcon: () => <span>AG</span>,
  ChatGptLogoIcon: () => <span>CG</span>,
  ClaudeLogoIcon: () => <span>CL</span>,
  GeminiLogoIcon: () => <span>GM</span>,
}));

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("ProviderConnectionHubButton", () => {
  it("shows the stable provider cards and hides the broken direct OpenAI OAuth path", () => {
    renderWithQueryClient(
      <ProviderConnectionHubButton
        availableModels={[
          {
            id: "model-antigravity",
            name: "Claude Sonnet via Antigravity",
            provider: "google-antigravity",
            modelId: "claude-sonnet-4-5",
            description: "Antigravity model",
            isEnabled: "true",
            enabledAt: null,
            displayOrder: 1,
            icon: null,
            modelType: "TEXT",
            contextWindow: 200000,
            source: "bootstrap",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("button-provider-connection-hub"));

    expect(screen.getByText("Loguear ChatGPT")).toBeInTheDocument();
    expect(screen.getByText("Loguear con Gemini")).toBeInTheDocument();
    expect(screen.getByText("Loguear con Antigravity")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI (OAuth directo)")).not.toBeInTheDocument();
    expect(screen.queryByText("Google Gemini (OAuth)")).not.toBeInTheDocument();
  });
});

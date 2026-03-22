import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authProfileState = vi.hoisted(() => ({
  profiles: {} as Record<string, any>,
  setAuthProfileOrder: vi.fn(async () => {}),
  ensureOpenClawModelsJson: vi.fn(async () => {}),
  ensurePiAuthJsonFromAuthProfiles: vi.fn(async () => {}),
  loadValidConfigOrThrow: vi.fn(async () => ({})),
  resolveUserScopedAgentDir: vi.fn(() => "/tmp/openai-codex-oauth-service-test"),
}));

vi.mock("./superIntelligence/agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: vi.fn(() => ({
    profiles: authProfileState.profiles,
  })),
  listProfilesForProvider: vi.fn((_store, provider: string) =>
    Object.entries(authProfileState.profiles)
      .filter(([, credential]) => credential?.provider === provider)
      .map(([profileId]) => profileId),
  ),
  setAuthProfileOrder: authProfileState.setAuthProfileOrder,
  upsertAuthProfile: vi.fn(
    ({
      profileId,
      credential,
    }: {
      profileId: string;
      credential: Record<string, unknown>;
    }) => {
      authProfileState.profiles[profileId] = credential;
    },
  ),
}));

vi.mock("./superIntelligence/agents/models-config.js", () => ({
  ensureOpenClawModelsJson: authProfileState.ensureOpenClawModelsJson,
}));

vi.mock("./superIntelligence/agents/pi-auth-json.js", () => ({
  ensurePiAuthJsonFromAuthProfiles: authProfileState.ensurePiAuthJsonFromAuthProfiles,
}));

vi.mock("./superIntelligence/commands/models/shared.js", () => ({
  loadValidConfigOrThrow: authProfileState.loadValidConfigOrThrow,
}));

vi.mock("./userScopedAgentDir.js", () => ({
  resolveUserScopedAgentDir: authProfileState.resolveUserScopedAgentDir,
}));

import {
  completeOpenAICodexOAuthFlowFromCallback,
  getOpenAICodexOAuthFlowState,
  startOpenAICodexOAuthFlow,
} from "./openAICodexOAuthService.js";

const originalFetch = globalThis.fetch;

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createAccessToken(accountId: string): string {
  return [
    toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    toBase64Url(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
        },
      }),
    ),
    "signature",
  ].join(".");
}

describe("openAICodexOAuthService", () => {
  beforeEach(() => {
    for (const key of Object.keys(authProfileState.profiles)) {
      delete authProfileState.profiles[key];
    }
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds ChatGPT auth URLs with the hosted callback instead of localhost", async () => {
    const redirectUri = "https://iliagpt.com/api/oauth/openai/codex/callback";

    const flow = await startOpenAICodexOAuthFlow({
      userId: "user-hosted-callback",
      redirectUri,
    });

    const authUrl = new URL(flow.authUrl);
    expect(flow.redirectUri).toBe(redirectUri);
    expect(authUrl.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(authUrl.searchParams.get("redirect_uri")).not.toContain("localhost");
    expect(authUrl.searchParams.get("state")).toBeTruthy();
  });

  it("completes the callback using the hosted redirect URI during token exchange", async () => {
    const redirectUri = "https://iliagpt.com/api/oauth/openai/codex/callback";
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      expect(body.get("redirect_uri")).toBe(redirectUri);
      expect(body.get("code")).toBe("auth-code-123");

      return new Response(
        JSON.stringify({
          access_token: createAccessToken("acct-123"),
          refresh_token: "refresh-token-123",
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const flow = await startOpenAICodexOAuthFlow({
      userId: "user-callback-complete",
      redirectUri,
    });
    const authUrl = new URL(flow.authUrl);
    const oauthState = authUrl.searchParams.get("state");
    expect(oauthState).toBeTruthy();

    const result = await completeOpenAICodexOAuthFlowFromCallback({
      oauthState: oauthState!,
      code: "auth-code-123",
    });

    expect(result.status).toBe("success");
    expect(result.result?.connected).toBe(true);
    expect(result.result?.accountId).toBe("acct-123");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(
      getOpenAICodexOAuthFlowState({
        flowId: flow.flowId,
        userId: "user-callback-complete",
      }).status,
    ).toBe("completed");
  });
});

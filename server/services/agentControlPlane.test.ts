import { afterEach, describe, expect, it } from "vitest";
import {
  applyAgentRoleDefaults,
  getAgentControlPlaneSnapshot,
  resolveAgentRole,
  resolvePrimaryGatewayProviderForRole,
  resolvePrimaryLlmModelForRole,
} from "./agentControlPlane";

const ORIGINAL_ENV = { ...process.env };

describe("agentControlPlane", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers Opus 4.6 as the brain when Anthropic is configured", () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.GOOGLE_API_KEY = "test-google";

    expect(resolvePrimaryLlmModelForRole("brain")).toBe("claude-opus-4-6");
    expect(resolveAgentRole("brain").provider).toBe("anthropic");
  });

  it("falls back to GPT-5.2 when Anthropic is unavailable", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.GOOGLE_API_KEY = "test-google";

    expect(resolvePrimaryLlmModelForRole("brain")).toBe("gpt-5.2");
    expect(resolveAgentRole("brain").provider).toBe("openai");
  });

  it("keeps Gemini Pro as the research lane and exposes continuous supervision", () => {
    process.env.GOOGLE_API_KEY = "test-google";

    const snapshot = getAgentControlPlaneSnapshot();

    expect(snapshot.roles.research.target).toBe("gemini-2.5-pro");
    expect(snapshot.capabilities.backgroundTasks).toBe(true);
    expect(snapshot.capabilities.continuousSupervision).toBe(true);
  });

  it("uses the active role defaults when no model is passed", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-openai";

    expect(applyAgentRoleDefaults({ agentRole: "brain" })).toEqual({
      agentRole: "brain",
      model: "gpt-5.2",
      provider: "openai",
    });
    expect(resolvePrimaryGatewayProviderForRole("brain")).toBe("openai");
  });

  it("honors explicit operator overrides for role routing", () => {
    process.env.GOOGLE_API_KEY = "test-google";
    process.env.AGENT_ROLE_RESEARCH_MODEL = "gemini-3.1-pro";

    const routing = applyAgentRoleDefaults({ agentRole: "research" });

    expect(routing.model).toBe("gemini-3.1-pro");
    expect(routing.provider).toBe("gemini");
    expect(resolveAgentRole("research").purpose).toContain("override");
  });

  it("reports only configured connectors in the capability snapshot", () => {
    process.env.GOOGLE_CLIENT_ID = "google-client";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.SLACK_BOT_TOKEN = "slack-token";
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_TOKEN;

    const snapshot = getAgentControlPlaneSnapshot();

    expect(snapshot.capabilities.connectorStack).toEqual(["Gmail", "Slack", "Calendar"]);
  });
});

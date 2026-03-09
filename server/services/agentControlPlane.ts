export type AgentRoleId =
  | "brain"
  | "research"
  | "search_memory"
  | "speed"
  | "image"
  | "video";

export type AgentLlmRoleId = Extract<AgentRoleId, "brain" | "research" | "search_memory" | "speed">;
export type AgentGatewayProvider = "anthropic" | "gemini" | "openai" | "xai" | "deepseek";

type AgentRoleLane = "llm" | "skill";

export interface AgentRoleCandidate {
  lane: AgentRoleLane;
  provider: string;
  target: string;
  purpose: string;
  configured: boolean;
}

export interface AgentRoleResolution extends AgentRoleCandidate {
  role: AgentRoleId;
  fallbacks: AgentRoleCandidate[];
}

export interface AgentControlPlaneSnapshot {
  generatedAt: string;
  roles: Record<AgentRoleId, AgentRoleResolution>;
  capabilities: {
    backgroundTasks: boolean;
    persistentSubagents: boolean;
    browserAutomation: boolean;
    connectorStack: string[];
    longTermMemory: boolean;
    continuousSupervision: boolean;
  };
}

type AgentRoleRoutingOptions = {
  agentRole?: AgentLlmRoleId;
  model?: string;
  provider?: AgentGatewayProvider | "auto";
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value: string | undefined): string | undefined {
  if (!hasValue(value)) {
    return undefined;
  }
  return value!.trim();
}

function hasAnthropic(): boolean {
  return hasValue(process.env.ANTHROPIC_API_KEY);
}

function hasGoogle(): boolean {
  return hasValue(process.env.GOOGLE_API_KEY) || hasValue(process.env.GEMINI_API_KEY);
}

function hasOpenAI(): boolean {
  return hasValue(process.env.OPENAI_API_KEY);
}

function hasXai(): boolean {
  return (
    hasValue(process.env.XAI_API_KEY) ||
    hasValue(process.env.GROK_API_KEY) ||
    hasValue(process.env.ILIAGPT_API_KEY)
  );
}

function hasNanoBanana(): boolean {
  return hasValue(process.env.NANO_BANANA_API_KEY) || hasGoogle();
}

function hasSlack(): boolean {
  return hasValue(process.env.SLACK_BOT_TOKEN) || hasValue(process.env.SLACK_WEBHOOK_URL);
}

function hasNotion(): boolean {
  return (
    hasValue(process.env.NOTION_API_KEY) ||
    hasValue(process.env.NOTION_TOKEN) ||
    hasValue(process.env.NOTION_INTERNAL_INTEGRATION_TOKEN)
  );
}

function hasGoogleWorkspaceAuth(): boolean {
  return hasValue(process.env.GOOGLE_CLIENT_ID) && hasValue(process.env.GOOGLE_CLIENT_SECRET);
}

function hasGmail(): boolean {
  return hasGoogleWorkspaceAuth() || hasValue(process.env.GMAIL_REFRESH_TOKEN);
}

function hasCalendar(): boolean {
  return hasGoogleWorkspaceAuth() || hasValue(process.env.GOOGLE_CALENDAR_ID);
}

function inferProviderFromTarget(target: string | undefined): string | undefined {
  const normalized = normalizeString(target)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("claude")) return "anthropic";
  if (normalized.includes("gemini") || normalized.includes("veo") || normalized.includes("nano-banana")) return "google";
  if (normalized.includes("gpt") || normalized.includes("openai-image")) return "openai";
  if (normalized.includes("grok")) return "xai";
  if (normalized.includes("deepseek")) return "deepseek";
  return undefined;
}

function isProviderConfigured(provider: string | undefined): boolean {
  switch (provider) {
    case "anthropic":
      return hasAnthropic();
    case "google":
      return hasGoogle();
    case "openai":
      return hasOpenAI();
    case "xai":
      return hasXai();
    case "deepseek":
      return hasValue(process.env.DEEPSEEK_API_KEY);
    default:
      return false;
  }
}

function toGatewayProvider(provider: string | undefined): AgentGatewayProvider | undefined {
  switch (provider) {
    case "google":
      return "gemini";
    case "anthropic":
    case "openai":
    case "xai":
    case "deepseek":
      return provider;
    default:
      return undefined;
  }
}

function roleEnvKey(role: AgentRoleId): string {
  return role.toUpperCase();
}

function getRoleOverride(role: AgentRoleId): AgentRoleCandidate | null {
  const envKey = roleEnvKey(role);
  const target =
    normalizeString(process.env[`AGENT_ROLE_${envKey}_MODEL`]) ??
    normalizeString(process.env[`SUPERAGENT_${envKey}_MODEL`]);
  if (!target) {
    return null;
  }

  const provider =
    normalizeString(process.env[`AGENT_ROLE_${envKey}_PROVIDER`]) ??
    normalizeString(process.env[`SUPERAGENT_${envKey}_PROVIDER`]) ??
    inferProviderFromTarget(target) ??
    "openai";
  const lane: AgentRoleLane = role === "image" ? "skill" : "llm";

  return {
    lane,
    provider,
    target,
    purpose: `Operator override for ${role}.`,
    configured: isProviderConfigured(provider),
  };
}

function resolveConnectorStack(): string[] {
  const connectors: string[] = [];
  if (hasGmail()) connectors.push("Gmail");
  if (hasSlack()) connectors.push("Slack");
  if (hasNotion()) connectors.push("Notion");
  if (hasCalendar()) connectors.push("Calendar");
  return connectors;
}

function baseRoleCandidates(): Record<AgentRoleId, AgentRoleCandidate[]> {
  return {
    brain: [
      {
        lane: "llm",
        provider: "anthropic",
        target: "claude-opus-4-6",
        purpose: "Primary reasoning brain for autonomous planning and hard decisions.",
        configured: hasAnthropic(),
      },
      {
        lane: "llm",
        provider: "openai",
        target: "gpt-5.2",
        purpose: "Broad fallback for search-heavy reasoning and long-term memory work.",
        configured: hasOpenAI(),
      },
      {
        lane: "llm",
        provider: "google",
        target: "gemini-2.5-pro",
        purpose: "Deep-context fallback when Anthropic/OpenAI are unavailable.",
        configured: hasGoogle(),
      },
      {
        lane: "llm",
        provider: "xai",
        target: "grok-4-1-fast-reasoning",
        purpose: "Last-resort reasoning fallback with low latency.",
        configured: hasXai(),
      },
    ],
    research: [
      {
        lane: "llm",
        provider: "google",
        target: "gemini-2.5-pro",
        purpose: "Deep research, synthesis, and long-context analysis.",
        configured: hasGoogle(),
      },
      {
        lane: "llm",
        provider: "openai",
        target: "gpt-5.2",
        purpose: "Fallback for broad web/search synthesis and memory-rich summarization.",
        configured: hasOpenAI(),
      },
      {
        lane: "llm",
        provider: "anthropic",
        target: "claude-opus-4-6",
        purpose: "Fallback when the primary research model is unavailable.",
        configured: hasAnthropic(),
      },
    ],
    search_memory: [
      {
        lane: "llm",
        provider: "openai",
        target: "gpt-5.2",
        purpose: "Wide search coverage, memory consolidation, and retrieval-grounded synthesis.",
        configured: hasOpenAI(),
      },
      {
        lane: "llm",
        provider: "google",
        target: "gemini-2.5-pro",
        purpose: "Fallback for memory-heavy or long-context search tasks.",
        configured: hasGoogle(),
      },
      {
        lane: "llm",
        provider: "xai",
        target: "grok-4-1-fast-non-reasoning",
        purpose: "Fast fallback for broad lookup passes.",
        configured: hasXai(),
      },
    ],
    speed: [
      {
        lane: "llm",
        provider: "xai",
        target: "grok-4-1-fast-non-reasoning",
        purpose: "Fast response lane for quick triage and low-latency tasks.",
        configured: hasXai(),
      },
      {
        lane: "llm",
        provider: "google",
        target: "gemini-2.5-flash",
        purpose: "Fallback fast lane when Grok is unavailable.",
        configured: hasGoogle(),
      },
      {
        lane: "llm",
        provider: "openai",
        target: "gpt-5-mini",
        purpose: "Fallback fast lane for lightweight execution.",
        configured: hasOpenAI(),
      },
    ],
    image: [
      {
        lane: "skill",
        provider: "google",
        target: "nano-banana-pro",
        purpose: "Preferred image generation/editing specialist.",
        configured: hasNanoBanana(),
      },
      {
        lane: "skill",
        provider: "openai",
        target: "openai-image-gen",
        purpose: "Fallback image generation specialist.",
        configured: hasOpenAI(),
      },
    ],
    video: [
      {
        lane: "llm",
        provider: "google",
        target: "veo-3.1-preview",
        purpose: "Preferred video generation specialist.",
        configured: hasGoogle(),
      },
    ],
  };
}

function roleCandidates(): Record<AgentRoleId, AgentRoleCandidate[]> {
  const candidates = baseRoleCandidates();

  for (const role of Object.keys(candidates) as AgentRoleId[]) {
    const override = getRoleOverride(role);
    if (!override) {
      continue;
    }

    const withoutDuplicate = candidates[role].filter(
      (candidate) => candidate.target !== override.target || candidate.provider !== override.provider,
    );
    candidates[role] = [override, ...withoutDuplicate];
  }

  return candidates;
}

function resolveRole(role: AgentRoleId): AgentRoleResolution {
  const candidates = roleCandidates()[role];
  const active = candidates.find((candidate) => candidate.configured) ?? candidates[0];
  const fallbacks = candidates.filter((candidate) => candidate !== active);

  return {
    role,
    ...active,
    fallbacks,
  };
}

export function resolveAgentRole(role: AgentRoleId): AgentRoleResolution {
  return resolveRole(role);
}

export function resolvePrimaryLlmModelForRole(role: AgentLlmRoleId): string {
  return resolveRole(role).target;
}

export function resolvePrimaryGatewayProviderForRole(role: AgentLlmRoleId): AgentGatewayProvider | undefined {
  return toGatewayProvider(resolveRole(role).provider);
}

export function applyAgentRoleDefaults<T extends AgentRoleRoutingOptions>(options: T): T {
  const model = normalizeString(options.model);
  if (model) {
    return {
      ...options,
      model,
    };
  }

  const role = options.agentRole ?? "brain";
  const resolution = resolveRole(role);
  const provider = options.provider ?? (resolution.configured ? toGatewayProvider(resolution.provider) : undefined);

  return {
    ...options,
    model: resolution.target,
    provider,
  };
}

export function getAgentControlPlaneSnapshot(): AgentControlPlaneSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    roles: {
      brain: resolveRole("brain"),
      research: resolveRole("research"),
      search_memory: resolveRole("search_memory"),
      speed: resolveRole("speed"),
      image: resolveRole("image"),
      video: resolveRole("video"),
    },
    capabilities: {
      backgroundTasks: true,
      persistentSubagents: true,
      browserAutomation: process.env.ENABLE_OPENCLAW_TOOLS === "true",
      connectorStack: resolveConnectorStack(),
      longTermMemory: true,
      continuousSupervision: true,
    },
  };
}

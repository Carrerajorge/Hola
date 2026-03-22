import { randomUUID } from "node:crypto";
import { loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  setAuthProfileOrder,
  upsertAuthProfile,
} from "./superIntelligence/agents/auth-profiles.js";
import { loadValidConfigOrThrow } from "./superIntelligence/commands/models/shared.js";
import { OPENAI_CODEX_DEFAULT_MODEL } from "./superIntelligence/commands/openai-codex-model-default.js";
import { ensureOpenClawModelsJson } from "./superIntelligence/agents/models-config.js";
import { ensurePiAuthJsonFromAuthProfiles } from "./superIntelligence/agents/pi-auth-json.js";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

const PROVIDER_ID = "openai-codex";
const DEFAULT_MODEL_REF = OPENAI_CODEX_DEFAULT_MODEL;
const DEFAULT_MODEL_ID = DEFAULT_MODEL_REF.replace(`${PROVIDER_ID}/`, "");
const FLOW_TTL_MS = 30 * 60 * 1000;

type OpenAICodexFlowRecord = {
  id: string;
  userId: string;
  createdAt: number;
  authUrl: string;
  redirectUri: string;
  manualInputResolver: ((value: string) => void) | null;
  manualInputRejecter: ((error: Error) => void) | null;
  completed: boolean;
  error: string | null;
  result: OpenAICodexOAuthStatus | null;
};

const flowStore = new Map<string, OpenAICodexFlowRecord>();

export type OpenAICodexOAuthStatus = {
  connected: boolean;
  providerId: typeof PROVIDER_ID;
  defaultModelRef: typeof DEFAULT_MODEL_REF;
  defaultModelId: typeof DEFAULT_MODEL_ID;
  profileId: string | null;
  accountId: string | null;
};

export type OpenAICodexBootstrapModel = {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  description: string;
  isEnabled: "true";
  enabledAt: null;
  displayOrder: number;
  icon: null;
  modelType: "TEXT";
  contextWindow: number;
};

function buildProfileId(credentials: OAuthCredentials): string {
  const rawAccountId =
    typeof credentials.accountId === "string" ? credentials.accountId.trim() : "";
  const normalizedAccountId = rawAccountId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${PROVIDER_ID}:${normalizedAccountId || "default"}`;
}

async function resolveStoredProfile(userId?: string | null) {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    return null;
  }

  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const profileIds = listProfilesForProvider(store, PROVIDER_ID);
  if (profileIds.length === 0) {
    return null;
  }

  const profileId = profileIds[0];
  const credential = store.profiles[profileId];
  if (!credential) {
    return null;
  }

  return {
    profileId,
    credential,
  };
}

function clearExpiredFlows(): void {
  const now = Date.now();
  for (const [flowId, flow] of flowStore.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      flow.manualInputRejecter?.(
        new Error("La sesión OAuth expiró. Inicia la vinculación otra vez."),
      );
      flowStore.delete(flowId);
    }
  }
}

async function persistOpenAICodexOAuthCredentials(
  credentials: OAuthCredentials,
  userId: string,
): Promise<void> {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    throw new Error("No se pudo resolver el almacenamiento OAuth del usuario.");
  }

  const profileId = buildProfileId(credentials);
  upsertAuthProfile({
    profileId,
    agentDir,
    credential: {
      type: "oauth",
      provider: PROVIDER_ID,
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      ...(typeof credentials.accountId === "string" && credentials.accountId.trim()
        ? { accountId: credentials.accountId.trim() }
        : {}),
    },
  });

  await setAuthProfileOrder({
    agentDir,
    provider: PROVIDER_ID,
    order: [profileId],
  });

  const config = await loadValidConfigOrThrow();
  await ensureOpenClawModelsJson(config, agentDir);
  await ensurePiAuthJsonFromAuthProfiles(agentDir);
}

function markFlowFailed(flow: OpenAICodexFlowRecord, error: unknown): void {
  flow.completed = true;
  flow.error = error instanceof Error ? error.message : String(error);
  flow.manualInputResolver = null;
  flow.manualInputRejecter = null;
}

async function markFlowCompleted(flow: OpenAICodexFlowRecord): Promise<void> {
  flow.result = await getOpenAICodexOAuthStatus(flow.userId);
  flow.completed = true;
  flow.error = null;
  flow.manualInputResolver = null;
  flow.manualInputRejecter = null;
}

function createManualInputPromise(flow: OpenAICodexFlowRecord): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    flow.manualInputResolver = resolve;
    flow.manualInputRejecter = reject;
  });
}

function startFlowExecution(flow: OpenAICodexFlowRecord): void {
  void (async () => {
    try {
      const credentials = await loginOpenAICodex({
        originator: "iliagpt-web",
        onAuth: ({ url }) => {
          flow.authUrl = url;
        },
        onPrompt: async () => {
          throw new Error(
            "Se requiere la URL final de localhost para completar ChatGPT OAuth.",
          );
        },
        onManualCodeInput: async () => {
          return await createManualInputPromise(flow);
        },
      });
      await persistOpenAICodexOAuthCredentials(credentials, flow.userId);
      await markFlowCompleted(flow);
    } catch (error) {
      markFlowFailed(flow, error);
    } finally {
      flow.manualInputRejecter = null;
    }
  })();
}

export async function getOpenAICodexOAuthStatus(
  userId?: string | null,
): Promise<OpenAICodexOAuthStatus> {
  const storedProfile = await resolveStoredProfile(userId);
  const accountId =
    storedProfile?.credential && "accountId" in storedProfile.credential
      ? storedProfile.credential.accountId ?? null
      : null;

  return {
    connected: Boolean(storedProfile),
    providerId: PROVIDER_ID,
    defaultModelRef: DEFAULT_MODEL_REF,
    defaultModelId: DEFAULT_MODEL_ID,
    profileId: storedProfile?.profileId ?? null,
    accountId,
  };
}

export async function getOpenAICodexBootstrapModel(
  userId?: string | null,
): Promise<OpenAICodexBootstrapModel | null> {
  const status = await getOpenAICodexOAuthStatus(userId);
  if (!status.connected) {
    return null;
  }

  return {
    id: "bootstrap-openai-codex-primary",
    name: "GPT-5.3 Codex (ChatGPT)",
    provider: PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    description: "GPT-5.3 Codex usando tu cuenta de ChatGPT con OAuth",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 1_050_000,
  };
}

export async function startOpenAICodexOAuthFlow(params: {
  userId: string;
}): Promise<{
  flowId: string;
  authUrl: string;
  redirectUri: string;
}> {
  clearExpiredFlows();

  const flowId = randomUUID();
  const flow: OpenAICodexFlowRecord = {
    id: flowId,
    userId: params.userId,
    createdAt: Date.now(),
    authUrl: "",
    redirectUri: "http://localhost:1455/auth/callback",
    manualInputResolver: null,
    manualInputRejecter: null,
    completed: false,
    error: null,
    result: null,
  };
  flowStore.set(flowId, flow);
  startFlowExecution(flow);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (flow.authUrl) {
      return {
        flowId,
        authUrl: flow.authUrl,
        redirectUri: flow.redirectUri,
      };
    }
    if (flow.completed && flow.error) {
      throw new Error(flow.error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("No se pudo preparar ChatGPT OAuth.");
}

function getOwnedFlow(flowId: string, userId: string): OpenAICodexFlowRecord {
  clearExpiredFlows();
  const flow = flowStore.get(flowId);
  if (!flow) {
    throw new Error("La sesión OAuth expiró. Inicia la vinculación otra vez.");
  }
  if (flow.userId !== userId) {
    throw new Error("La sesión OAuth no pertenece a este usuario.");
  }
  return flow;
}

export function submitOpenAICodexOAuthManualInput(params: {
  flowId: string;
  userId: string;
  input: string;
}): void {
  const flow = getOwnedFlow(params.flowId, params.userId);
  if (flow.completed) {
    return;
  }

  const value = params.input.trim();
  if (!value) {
    throw new Error("Debes pegar la URL final de localhost o el código.");
  }
  if (!flow.manualInputResolver) {
    throw new Error("El flujo todavía no está listo para completar manualmente.");
  }
  flow.manualInputResolver(value);
  flow.manualInputResolver = null;
  flow.manualInputRejecter = null;
}

export function getOpenAICodexOAuthFlowState(params: {
  flowId: string;
  userId: string;
}): {
  flowId: string;
  status: "pending" | "completed" | "failed";
  authUrl: string;
  redirectUri: string;
  result: OpenAICodexOAuthStatus | null;
  error: string | null;
} {
  const flow = getOwnedFlow(params.flowId, params.userId);
  return {
    flowId: flow.id,
    status: flow.completed ? (flow.error ? "failed" : "completed") : "pending",
    authUrl: flow.authUrl,
    redirectUri: flow.redirectUri,
    result: flow.result,
    error: flow.error,
  };
}

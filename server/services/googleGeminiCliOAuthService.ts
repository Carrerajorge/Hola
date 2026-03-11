import { DEFAULT_AGENT_ID } from "./superIntelligence/routing/session-key.js";
import { resolveOpenClawAgentDir } from "./superIntelligence/agents/agent-paths.js";
import { resolveAgentDir, resolveDefaultAgentId } from "./superIntelligence/agents/agent-scope.js";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  upsertAuthProfile,
} from "./superIntelligence/agents/auth-profiles.js";
import { applyAuthProfileConfig } from "./superIntelligence/commands/onboard-auth.js";
import { loadValidConfigOrThrow, updateConfig } from "./superIntelligence/commands/models/shared.js";
import { applyDefaultModel } from "./superIntelligence/commands/provider-auth-helpers.js";
import { enablePluginInConfig } from "./superIntelligence/plugins/enable.js";
import {
  completeGeminiCliOAuthSession,
  startGeminiCliOAuthSession,
  type GeminiCliOAuthCredentials,
} from "../openclaw/extensions/google-gemini-cli-auth/oauth.js";

const PROVIDER_ID = "google-gemini-cli";
const PROVIDER_PLUGIN_ID = "google-gemini-cli-auth";
const DEFAULT_MODEL_REF = "google-gemini-cli/gemini-3.1-pro-preview";
const DEFAULT_MODEL_ID = "gemini-3.1-pro-preview";

export type GoogleGeminiCliOAuthStatus = {
  connected: boolean;
  providerId: typeof PROVIDER_ID;
  defaultModelRef: typeof DEFAULT_MODEL_REF;
  defaultModelId: typeof DEFAULT_MODEL_ID;
  profileId: string | null;
  email: string | null;
};

export type GoogleGeminiCliBootstrapModel = {
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

function resolveScopedAgentDir(config: Awaited<ReturnType<typeof loadValidConfigOrThrow>>): string {
  const defaultAgentId = resolveDefaultAgentId(config);
  if (defaultAgentId === DEFAULT_AGENT_ID) {
    return resolveOpenClawAgentDir();
  }
  return resolveAgentDir(config, defaultAgentId);
}

async function resolveAuthStoreAgentDir(): Promise<string | undefined> {
  try {
    const config = await loadValidConfigOrThrow();
    return resolveScopedAgentDir(config);
  } catch {
    return undefined;
  }
}

async function resolveStoredProfile() {
  const agentDir = await resolveAuthStoreAgentDir();
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

function buildProfileId(email?: string | null): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return `${PROVIDER_ID}:${normalized || "default"}`;
}

async function persistGeminiCliOAuthCredentials(credentials: GeminiCliOAuthCredentials): Promise<void> {
  const config = await loadValidConfigOrThrow();
  const agentDir = resolveScopedAgentDir(config);
  const profileId = buildProfileId(credentials.email);

  await updateConfig((currentConfig) => {
    const enabledPluginResult = enablePluginInConfig(currentConfig, PROVIDER_PLUGIN_ID);
    if (!enabledPluginResult.enabled) {
      throw new Error(
        `No se pudo habilitar ${PROVIDER_PLUGIN_ID}: ${enabledPluginResult.reason || "bloqueado"}`,
      );
    }

    let nextConfig = enabledPluginResult.config;
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId,
      provider: PROVIDER_ID,
      mode: "oauth",
      ...(credentials.email ? { email: credentials.email } : {}),
    });
    nextConfig = applyDefaultModel(nextConfig, DEFAULT_MODEL_REF);
    return nextConfig;
  });

  upsertAuthProfile({
    profileId,
    agentDir,
    credential: {
      type: "oauth",
      provider: PROVIDER_ID,
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      projectId: credentials.projectId,
      ...(credentials.email ? { email: credentials.email } : {}),
    },
  });
}

export function beginGoogleGeminiCliOAuthFlow() {
  return startGeminiCliOAuthSession();
}

export async function finishGoogleGeminiCliOAuthFlow(params: {
  callbackInput: string;
  verifier: string;
}): Promise<GoogleGeminiCliOAuthStatus> {
  const credentials = await completeGeminiCliOAuthSession({
    callbackInput: params.callbackInput,
    verifier: params.verifier,
  });
  await persistGeminiCliOAuthCredentials(credentials);
  return await getGoogleGeminiCliOAuthStatus();
}

export async function getGoogleGeminiCliOAuthStatus(): Promise<GoogleGeminiCliOAuthStatus> {
  const storedProfile = await resolveStoredProfile();
  const email =
    storedProfile?.credential && "email" in storedProfile.credential
      ? storedProfile.credential.email ?? null
      : null;

  return {
    connected: Boolean(storedProfile),
    providerId: PROVIDER_ID,
    defaultModelRef: DEFAULT_MODEL_REF,
    defaultModelId: DEFAULT_MODEL_ID,
    profileId: storedProfile?.profileId ?? null,
    email,
  };
}

export async function getGoogleGeminiCliBootstrapModel(): Promise<GoogleGeminiCliBootstrapModel | null> {
  const status = await getGoogleGeminiCliOAuthStatus();
  if (!status.connected) {
    return null;
  }

  return {
    id: "bootstrap-google-gemini-cli-pro",
    name: "Gemini 3.1 Pro (Google OAuth)",
    provider: PROVIDER_ID,
    modelId: DEFAULT_MODEL_ID,
    description: "Gemini 3.1 Pro usando la cuenta de Google vinculada por OAuth",
    isEnabled: "true",
    enabledAt: null,
    displayOrder: 1,
    icon: null,
    modelType: "TEXT",
    contextWindow: 2000000,
  };
}

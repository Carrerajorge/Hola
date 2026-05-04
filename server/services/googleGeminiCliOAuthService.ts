import fs from "node:fs";
import path from "node:path";
import { resolveUserScopedAgentDir } from "./userScopedAgentDir.js";

export type GeminiCliOAuthCredentials = {
  access: string;
  refresh: string;
  expires: number;
  email?: string;
  projectId: string;
};

async function loadOpenClawOAuthModule() {
  return await import("../openclaw/extensions/google-gemini-cli-auth/oauth.js");
}

const PROVIDER_ID = "google-gemini-cli";
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

type AuthProfileStore = {
  version: number;
  profiles: Record<string, Record<string, unknown>>;
  order?: Record<string, string[]>;
};

function loadAuthStoreFromDisk(storePath: string): AuthProfileStore | null {
  try {
    if (!fs.existsSync(storePath)) return null;
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.profiles) {
      return parsed as AuthProfileStore;
    }
  } catch {}
  return null;
}

function saveAuthStoreToDisk(storePath: string, store: AuthProfileStore): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try { fs.chmodSync(storePath, 0o600); } catch {}
}

async function resolveStoredProfile(userId?: string | null) {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    return null;
  }

  const storePath = path.join(agentDir, "auth-profiles.json");
  const store = loadAuthStoreFromDisk(storePath);
  if (!store) return null;

  const profileIds = Object.keys(store.profiles).filter(
    (id) => {
      const cred = store.profiles[id];
      return cred && (cred.provider === PROVIDER_ID || id.startsWith(`${PROVIDER_ID}:`));
    },
  );
  if (profileIds.length === 0) return null;

  const profileId = profileIds[0];
  const credential = store.profiles[profileId];
  if (!credential) return null;

  return { profileId, credential };
}

function buildProfileId(email?: string | null): string {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return `${PROVIDER_ID}:${normalized || "default"}`;
}

async function persistGeminiCliOAuthCredentials(
  credentials: GeminiCliOAuthCredentials,
  userId: string,
): Promise<void> {
  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    throw new Error("No se pudo resolver el almacenamiento OAuth del usuario.");
  }

  const profileId = buildProfileId(credentials.email);
  const storePath = path.join(agentDir, "auth-profiles.json");

  const credential: Record<string, unknown> = {
    type: "oauth",
    provider: PROVIDER_ID,
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires,
    projectId: credentials.projectId,
    ...(credentials.email ? { email: credentials.email } : {}),
  };

  try {
    const existing = loadAuthStoreFromDisk(storePath) ?? {
      version: 1,
      profiles: {},
    };
    existing.profiles[profileId] = credential;
    existing.order = existing.order ?? {};
    existing.order[PROVIDER_ID] = [profileId];
    saveAuthStoreToDisk(storePath, existing);
    console.info("[GeminiCliOAuth] Credentials persisted to:", storePath);
  } catch (profileError) {
    console.error(
      "[GeminiCliOAuth] Direct credential persistence failed:",
      profileError instanceof Error ? profileError.message : profileError,
    );
    throw new Error("No se pudo guardar el perfil OAuth. Revisa permisos del directorio del servidor.");
  }

  // Best-effort: try to use the full OpenClaw module chain for enhanced integration
  try {
    const { upsertAuthProfile, setAuthProfileOrder } = await import(
      "./superIntelligence/agents/auth-profiles.js"
    );
    upsertAuthProfile({ profileId, agentDir, credential });
    await setAuthProfileOrder({
      agentDir,
      provider: PROVIDER_ID,
      order: [profileId],
    });
  } catch (enhancedError) {
    console.warn(
      "[GeminiCliOAuth] Enhanced OpenClaw profile integration skipped (non-critical):",
      enhancedError instanceof Error ? enhancedError.message : enhancedError,
    );
  }
}

/**
 * Persists Google OAuth tokens as Gemini CLI credentials directly.
 * Called from the Google OAuth callback when provider_hint is gemini/antigravity,
 * allowing single-step login + Gemini CLI credential persistence.
 */
export async function persistGeminiCliCredentialsFromGoogleTokens(
  userId: string,
  email?: string,
  tokens?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
  },
): Promise<void> {
  if (!tokens?.access_token) {
    console.warn("[GeminiCliOAuth] No tokens to persist for user:", userId);
    return;
  }

  const credentials: GeminiCliOAuthCredentials = {
    access: tokens.access_token,
    refresh: tokens.refresh_token || "",
    expires: tokens.expires_at
      ? tokens.expires_at * 1000
      : Date.now() + 3600 * 1000,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      "gemini-cli-free-tier",
    email: email?.trim().toLowerCase(),
  };

  await persistGeminiCliOAuthCredentials(credentials, userId);
}

export async function beginGoogleGeminiCliOAuthFlow(params?: {
  redirectUri?: string;
  state?: string;
  loginHint?: string;
}) {
  const mod = await loadOpenClawOAuthModule();
  return mod.startGeminiCliOAuthSession(params);
}

export async function finishGoogleGeminiCliOAuthFlow(params: {
  callbackInput: string;
  verifier: string;
  redirectUri?: string;
  expectedState?: string;
  userId: string;
}): Promise<GoogleGeminiCliOAuthStatus> {
  const mod = await loadOpenClawOAuthModule();
  const credentials = await mod.completeGeminiCliOAuthSession({
    callbackInput: params.callbackInput,
    verifier: params.verifier,
    redirectUri: params.redirectUri,
    expectedState: params.expectedState,
  });
  await persistGeminiCliOAuthCredentials(credentials, params.userId);
  return await getGoogleGeminiCliOAuthStatus(params.userId);
}

export async function getGoogleGeminiCliOAuthStatus(
  userId?: string | null,
): Promise<GoogleGeminiCliOAuthStatus> {
  const storedProfile = await resolveStoredProfile(userId);
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

export async function getGoogleGeminiCliBootstrapModel(
  userId?: string | null,
): Promise<GoogleGeminiCliBootstrapModel | null> {
  const status = await getGoogleGeminiCliOAuthStatus(userId);
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

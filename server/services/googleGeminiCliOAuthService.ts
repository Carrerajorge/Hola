import { createHash, randomBytes } from "node:crypto";
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

const PROVIDER_ID = "google-gemini-cli";
const DEFAULT_MODEL_REF = "google-gemini-cli/gemini-3.1-pro-preview";
const DEFAULT_MODEL_ID = "gemini-3.1-pro-preview";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

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

// ── Native PKCE OAuth (fallback when OpenClaw module unavailable) ──

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function resolveOAuthClientConfig(): { clientId: string; clientSecret?: string } {
  const clientId = (
    process.env.OPENCLAW_GEMINI_OAUTH_CLIENT_ID ||
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ""
  ).trim();

  const clientSecret = (
    process.env.OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET ||
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ""
  ).trim();

  if (!clientId) {
    throw new Error(
      "No se encontraron credenciales OAuth para Gemini CLI. Configura GOOGLE_CLIENT_ID.",
    );
  }

  return { clientId, clientSecret: clientSecret || undefined };
}

function nativeStartGeminiCliOAuthSession(params?: {
  redirectUri?: string;
  state?: string;
  loginHint?: string;
}): {
  verifier: string;
  state: string;
  authUrl: string;
  redirectUri: string;
} {
  const { clientId } = resolveOAuthClientConfig();
  const { verifier, challenge } = generatePkce();
  const redirectUri = params?.redirectUri?.trim() || "http://localhost:8085/oauth2callback";
  const state = params?.state?.trim() || verifier;

  const urlParams = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GEMINI_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
  });

  const loginHint = params?.loginHint?.trim();
  if (loginHint) {
    urlParams.set("login_hint", loginHint);
  }

  return {
    verifier,
    state,
    authUrl: `${AUTH_URL}?${urlParams.toString()}`,
    redirectUri,
  };
}

function parseCallbackInput(
  input: string,
  expectedState: string,
): { code: string; state: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { error: "No input provided" };
  }

  try {
    const url = new URL(trimmed);
    const isAuthorizationUrl =
      url.hostname === "accounts.google.com" &&
      (url.pathname === "/o/oauth2/v2/auth" || url.pathname === "/o/oauth2/auth");
    if (isAuthorizationUrl) {
      return {
        error:
          "Pegaste la URL de autorización de Google. Completa el login y pega la URL final con ?code=...&state=....",
      };
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? expectedState;
    if (!code) {
      return { error: "Missing 'code' parameter in URL" };
    }
    return { code, state };
  } catch {
    const normalized =
      trimmed.startsWith("?")
        ? trimmed
        : trimmed.startsWith("code=") || trimmed.startsWith("state=") || trimmed.includes("&code=") || trimmed.includes("&state=")
          ? `?${trimmed}`
          : "";
    if (normalized) {
      const qsParams = new URLSearchParams(normalized.slice(1));
      const code = qsParams.get("code")?.trim();
      const state = qsParams.get("state")?.trim() || expectedState;
      if (!code) {
        return { error: "Missing 'code' parameter in callback input" };
      }
      return { code, state };
    }
    if (!expectedState) {
      return { error: "Paste the full redirect URL, not just the code." };
    }
    return { code: trimmed, state: expectedState };
  }
}

async function nativeExchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<GeminiCliOAuthCredentials> {
  const { clientId, clientSecret } = resolveOAuthClientConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await globalThis.fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "*/*",
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    let detail = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      detail = errorJson.error_description || errorJson.error || errorText;
    } catch {}
    console.error("[GeminiCliOAuth] Token exchange failed:", {
      status: response.status,
      clientId: clientId.slice(0, 12) + "...",
      redirectUri,
      detail,
    });
    throw new Error(`Token exchange failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!data.refresh_token) {
    console.warn("[GeminiCliOAuth] No refresh_token in response — user may need to revoke and re-authorize.");
  }

  let email: string | undefined;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const userRes = await globalThis.fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: ctrl.signal,
      });
      if (userRes.ok) {
        const userInfo = (await userRes.json()) as { email?: string };
        email = userInfo.email;
      }
    } finally {
      clearTimeout(t);
    }
  } catch {}

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    "gemini-cli-free-tier";

  const expiresAt = Date.now() + data.expires_in * 1000 - 5 * 60 * 1000;

  return {
    refresh: data.refresh_token || "",
    access: data.access_token,
    expires: expiresAt,
    projectId,
    email,
  };
}

async function nativeCompleteGeminiCliOAuthSession(params: {
  callbackInput: string;
  verifier: string;
  redirectUri?: string;
  expectedState?: string;
}): Promise<GeminiCliOAuthCredentials> {
  const expectedState = params.expectedState?.trim() || params.verifier;
  const redirectUri = params.redirectUri?.trim() || "http://localhost:8085/oauth2callback";
  const parsed = parseCallbackInput(params.callbackInput, expectedState);
  if ("error" in parsed) {
    throw new Error(parsed.error);
  }
  if (parsed.state !== expectedState && !parsed.state.includes(expectedState)) {
    throw new Error("OAuth state mismatch - please try again");
  }
  return await nativeExchangeCodeForTokens(parsed.code, params.verifier, redirectUri);
}

// ── Public API ──

async function loadOpenClawOAuthModule() {
  return await import("../openclaw/extensions/google-gemini-cli-auth/oauth.js");
}

export async function beginGoogleGeminiCliOAuthFlow(params?: {
  redirectUri?: string;
  state?: string;
  loginHint?: string;
}) {
  try {
    const mod = await loadOpenClawOAuthModule();
    return mod.startGeminiCliOAuthSession(params);
  } catch (openclawError) {
    console.warn(
      "[GeminiCliOAuth] OpenClaw module unavailable, using native OAuth:",
      openclawError instanceof Error ? openclawError.message : openclawError,
    );
  }
  return nativeStartGeminiCliOAuthSession(params);
}

export async function finishGoogleGeminiCliOAuthFlow(params: {
  callbackInput: string;
  verifier: string;
  redirectUri?: string;
  expectedState?: string;
  userId: string;
}): Promise<GoogleGeminiCliOAuthStatus> {
  let credentials: GeminiCliOAuthCredentials;

  try {
    const mod = await loadOpenClawOAuthModule();
    credentials = await mod.completeGeminiCliOAuthSession({
      callbackInput: params.callbackInput,
      verifier: params.verifier,
      redirectUri: params.redirectUri,
      expectedState: params.expectedState,
    });
  } catch (openclawError) {
    console.warn(
      "[GeminiCliOAuth] OpenClaw module unavailable for token exchange, using native:",
      openclawError instanceof Error ? openclawError.message : openclawError,
    );
    credentials = await nativeCompleteGeminiCliOAuthSession({
      callbackInput: params.callbackInput,
      verifier: params.verifier,
      redirectUri: params.redirectUri,
      expectedState: params.expectedState,
    });
  }

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

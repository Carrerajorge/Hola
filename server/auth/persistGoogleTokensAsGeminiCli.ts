/**
 * Persists Google OAuth tokens as Gemini CLI credentials so the user can
 * access Gemini models without a second OAuth popup.
 *
 * This is called after a successful Google OAuth login when the user came
 * from the Gemini or Antigravity login button (provider_hint).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveUserScopedAgentDir } from "../services/userScopedAgentDir";

const PROVIDER_ID = "google-gemini-cli";

export async function persistGoogleTokensAsGeminiCli(
  userId: string,
  email?: string,
  directTokens?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
  },
): Promise<void> {
  let tokens: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
  } | null = null;

  if (directTokens) {
    tokens = {
      access_token: directTokens.access_token,
      refresh_token: directTokens.refresh_token,
      expiry_date: directTokens.expires_at
        ? directTokens.expires_at * 1000
        : Date.now() + 3600 * 1000,
    };
  } else {
    try {
      const { tokenManager } = await import("../lib/auth/tokenManager.js");
      tokens = await tokenManager.getTokens(userId, "google");
    } catch {
      // Token retrieval might fail if encryption key isn't set or module unavailable
    }
  }

  if (!tokens?.access_token) {
    console.warn("[GeminiCliPersist] No Google tokens found for user:", userId);
    return;
  }

  // Database persistence (survives container restarts, primary storage)
  try {
    const { providersService } = await import("../services/providersService.js");
    const expiresAt = tokens.expiry_date || Date.now() + 3600 * 1000;
    await providersService.saveUserToken(
      userId,
      "gemini",
      tokens.access_token,
      tokens.refresh_token || null,
      expiresAt,
      "https://www.googleapis.com/auth/generative-language",
    );
    console.info("[GeminiCliPersist] Gemini token saved to DB for user:", userId);
  } catch (dbError: any) {
    console.warn(
      "[GeminiCliPersist] DB persistence failed (non-critical):",
      dbError?.message || dbError,
    );
  }

  const agentDir = resolveUserScopedAgentDir(userId);
  if (!agentDir) {
    console.info("[GeminiCliPersist] No agent dir for user (DB persistence already done):", userId);
    return;
  }

  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  const profileId = `${PROVIDER_ID}:${normalizedEmail || "default"}`;
  const storePath = path.join(agentDir, "auth-profiles.json");

  const credential = {
    type: "oauth" as const,
    provider: PROVIDER_ID,
    access: tokens.access_token,
    refresh: tokens.refresh_token || "",
    expires: tokens.expiry_date || Date.now() + 3600 * 1000,
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      "gemini-cli-free-tier",
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
  };

  // Direct file-system persistence (always works, no external deps)
  try {
    let store: { version: number; profiles: Record<string, unknown>; order?: Record<string, string[]> } = {
      version: 1,
      profiles: {},
    };
    try {
      if (fs.existsSync(storePath)) {
        const raw = fs.readFileSync(storePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.profiles) store = parsed;
      }
    } catch {}

    store.profiles[profileId] = credential;
    store.order = store.order ?? {};
    store.order[PROVIDER_ID] = [profileId];

    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    try { fs.chmodSync(storePath, 0o600); } catch {}

    console.info(
      "[GeminiCliPersist] Persisted Google tokens as Gemini CLI profile for user:",
      userId,
      email || "(no email)",
    );
  } catch (persistError: any) {
    console.warn(
      "[GeminiCliPersist] Direct persistence failed:",
      persistError?.message || persistError,
    );
  }

  // Best-effort: enhanced integration via OpenClaw module chain
  try {
    const { upsertAuthProfile, setAuthProfileOrder } = await import(
      "../services/superIntelligence/agents/auth-profiles.js"
    );
    upsertAuthProfile({ profileId, agentDir, credential });
    await setAuthProfileOrder({
      agentDir,
      provider: PROVIDER_ID,
      order: [profileId],
    });
  } catch {
    // Non-critical: direct persistence already succeeded
  }
}

/**
 * Persists Google OAuth tokens as Gemini CLI credentials so the user can
 * access Gemini models without a second OAuth popup.
 *
 * This is called after a successful Google OAuth login when the user came
 * from the Gemini or Antigravity login button (provider_hint).
 */
import { tokenManager } from "../lib/auth/tokenManager";
import { resolveUserScopedAgentDir } from "../services/userScopedAgentDir";

export async function persistGoogleTokensAsGeminiCli(
  userId: string,
  email?: string,
): Promise<void> {
  // Retrieve the Google tokens that Passport just saved
  let tokens: {
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    scope?: string;
  } | null = null;

  try {
    tokens = await tokenManager.getTokens(userId, "google");
  } catch {
    // Token retrieval might fail if encryption key isn't set
  }

  if (!tokens?.access_token) {
    console.warn("[GeminiCliPersist] No Google tokens found for user:", userId);
    return;
  }

  // Try to persist as Gemini CLI auth profile (OpenClaw integration)
  try {
    const {
      ensureAuthProfileStore,
      upsertAuthProfile,
      setAuthProfileOrder,
    } = await import(
      "../services/superIntelligence/agents/auth-profiles.js"
    );

    const agentDir = resolveUserScopedAgentDir(userId);
    if (!agentDir) {
      console.warn("[GeminiCliPersist] No agent dir for user:", userId);
      return;
    }

    const PROVIDER_ID = "google-gemini-cli";
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const profileId = `${PROVIDER_ID}:${normalizedEmail || "default"}`;

    upsertAuthProfile({
      profileId,
      agentDir,
      credential: {
        type: "oauth",
        provider: PROVIDER_ID,
        access: tokens.access_token,
        refresh: tokens.refresh_token || "",
        expires: tokens.expiry_date || Date.now() + 3600 * 1000,
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.GOOGLE_CLOUD_PROJECT_ID ||
          "gemini-cli-free-tier",
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
      },
    });

    try {
      await setAuthProfileOrder({
        agentDir,
        provider: PROVIDER_ID,
        order: [profileId],
      });
    } catch {
      // Non-critical
    }

    console.info(
      "[GeminiCliPersist] Persisted Google tokens as Gemini CLI profile for user:",
      userId,
      email || "(no email)",
    );
  } catch (profileError: any) {
    console.warn(
      "[GeminiCliPersist] Auth profile persistence failed:",
      profileError?.message || profileError,
    );
  }
}

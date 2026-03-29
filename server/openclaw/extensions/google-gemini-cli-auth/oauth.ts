export interface GeminiCliOAuthCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  email?: string;
}

export interface OAuthSession {
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

export async function startGeminiCliOAuthSession(): Promise<{ url: string; session: OAuthSession }> {
  const session: OAuthSession = {
    codeVerifier: "",
    state: crypto.randomUUID(),
    redirectUri: "http://localhost:0/callback",
  };
  return {
    url: "https://accounts.google.com/o/oauth2/v2/auth",
    session,
  };
}

export async function completeGeminiCliOAuthSession(
  _code: string,
  _session: OAuthSession,
): Promise<GeminiCliOAuthCredentials> {
  return {
    access_token: "",
    refresh_token: "",
    expires_at: Date.now() + 3600000,
  };
}

export function isOAuthCredentials(value: unknown): value is GeminiCliOAuthCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    "access_token" in value &&
    "refresh_token" in value &&
    "expires_at" in value
  );
}

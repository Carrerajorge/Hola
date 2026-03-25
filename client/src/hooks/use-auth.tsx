
import { createContext, ReactNode, useContext, useEffect, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import {
  FORCE_SIGNED_OUT_STORAGE_KEY,
  clearForcedSignedOutFlag,
  hasLoggedOutMarker,
  hasOAuthSuccessMarker,
  isPublicAuthRoute,
  shouldDeferAuthenticatedBootstrap,
  shouldSkipAnonymousIdentity,
} from "@/lib/auth-flow";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";

function isAnonymousUser(user: User | null): boolean {
  if (!user) return false;
  const anyUser = user as any;
  if (anyUser?.isAnonymous === true) return true;
  if (typeof anyUser?.authProvider === "string" && anyUser.authProvider.toLowerCase() === "anonymous") return true;
  if (typeof user.id === "string" && user.id.startsWith("anon_")) return true;
  // Some backends surface anonymous users without a dedicated flag; treat known patterns as anon.
  if (typeof anyUser?.username === "string" && anyUser.username.startsWith("Guest-")) return true;
  return false;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isReady: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refreshAuth: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- Storage Helpers ---

function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// FRONTEND FIX #5: Only store non-sensitive user data in localStorage
function setStoredUser(user: User | null): void {
  try {
    if (user) {
      // Only store minimal user info, never store tokens or sensitive data
      const safeUserData = {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        plan: user.plan,
        status: (user as any).status,
        subscriptionStatus: (user as any).subscriptionStatus,
        subscriptionPlan: (user as any).subscriptionPlan,
        subscriptionPeriodEnd: (user as any).subscriptionPeriodEnd,
        subscriptionExpiresAt: (user as any).subscriptionExpiresAt,
        avatarUrl: user.avatarUrl,
        // Explicitly exclude: password, tokens, secrets, etc.
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safeUserData));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function parseUserPayload(payload: unknown): User | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.id !== "string" || data.id.trim().length === 0 || data.id.length > 128) {
    return null;
  }
  return {
    id: data.id,
    email: typeof data.email === "string" ? data.email : undefined,
    fullName: typeof data.fullName === "string" ? data.fullName : undefined,
    role: typeof data.role === "string" ? data.role : undefined,
    plan: typeof data.plan === "string" ? data.plan : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    subscriptionStatus: typeof data.subscriptionStatus === "string" ? data.subscriptionStatus : undefined,
    subscriptionPlan: typeof data.subscriptionPlan === "string" ? data.subscriptionPlan : undefined,
    subscriptionPeriodEnd:
      typeof data.subscriptionPeriodEnd === "string" || data.subscriptionPeriodEnd instanceof Date
        ? (data.subscriptionPeriodEnd as any)
        : undefined,
    subscriptionExpiresAt:
      typeof data.subscriptionExpiresAt === "string" || data.subscriptionExpiresAt instanceof Date
        ? (data.subscriptionExpiresAt as any)
        : undefined,
    avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined,
    isAnonymous: data.isAnonymous === true,
    username: typeof data.username === "string" ? data.username : undefined,
    authProvider: typeof data.authProvider === "string" ? data.authProvider : undefined,
  } as User;
}

function clearOldUserData(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getStoredAnonUserId(): string | null {
  try {
    return localStorage.getItem(ANON_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function getStoredAnonToken(): string | null {
  try {
    return localStorage.getItem(ANON_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredAnonUserId(id: string): void {
  try {
    localStorage.setItem(ANON_USER_ID_KEY, id);
  } catch {
    // Ignore
  }
}

function clearAnonUserId(): void {
  try {
    localStorage.removeItem(ANON_USER_ID_KEY);
    localStorage.removeItem(ANON_TOKEN_KEY);
  } catch {
    // Ignore
  }
}

function setStoredAnonToken(token: string): void {
  try {
    localStorage.setItem(ANON_TOKEN_KEY, token);
  } catch {
    // Ignore
  }
}

function isForcedSignedOut(): boolean {
  try {
    return localStorage.getItem(FORCE_SIGNED_OUT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setForcedSignedOut(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(FORCE_SIGNED_OUT_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(FORCE_SIGNED_OUT_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

// --- Fetch Logic ---

type SessionIdentityPayload = {
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  token?: string | null;
  isAnonymous?: boolean;
};

function applyAuthenticatedUser(user: User): User {
  setStoredUser(user);
  clearAnonUserId();
  setForcedSignedOut(false);
  return user;
}

function parseSessionIdentityUser(identity: SessionIdentityPayload): User | null {
  if (!identity.userId || typeof identity.userId !== "string") return null;

  if (identity.isAnonymous) {
    setStoredAnonUserId(identity.userId);
    if (identity.token) {
      setStoredAnonToken(identity.token);
    }
    return {
      id: identity.userId,
      isAnonymous: true,
      username: `Guest-${identity.userId.slice(0, 4)}`,
      role: "user",
    } as User;
  }

  return {
    id: identity.userId,
    email: typeof identity.email === "string" ? identity.email : undefined,
    role: typeof identity.role === "string" ? identity.role : "user",
    isAnonymous: false,
  } as User;
}

async function fetchSessionIdentity(headers: HeadersInit): Promise<User | null> {
  try {
    const identityRes = await fetch("/api/session/identity", {
      credentials: "include",
      headers,
    });
    if (!identityRes.ok) return null;

    const identity = (await identityRes.json()) as SessionIdentityPayload;
    return parseSessionIdentityUser(identity);
  } catch (e) {
    console.error("Failed to get session identity:", e);
    return null;
  }
}

async function fetchUser(): Promise<User | null> {
  const storedAnonId = getStoredAnonUserId();
  const headers: HeadersInit = {};
  if (storedAnonId) {
    headers['X-Anonymous-User-Id'] = storedAnonId;
  }

  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const forcedSignedOut = isForcedSignedOut();
  const publicAuthRoute = isPublicAuthRoute(pathname);
  const loggedOut = hasLoggedOutMarker(search);
  const oauthSuccess = hasOAuthSuccessMarker(search);

  if (publicAuthRoute && !loggedOut && !oauthSuccess && !forcedSignedOut) {
    const identityUser = await fetchSessionIdentity(headers);
    if (!identityUser) {
      clearOldUserData();
      return null;
    }

    if (isAnonymousUser(identityUser)) {
      clearOldUserData();
      return null;
    }

    return applyAuthenticatedUser(identityUser);
  }

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  if (response.ok) {
    const user = parseUserPayload(await response.json());
    if (!user) {
      clearOldUserData();
      return null;
    }
    return applyAuthenticatedUser(user);
  }
  
  if (response.status === 401 || response.status === 403) {
    clearOldUserData();

    // Public/auth routes should stay fast and OAuth callback recovery must not fall back to guest mode.
    if (shouldSkipAnonymousIdentity(pathname, search, forcedSignedOut)) {
      if (loggedOut) setForcedSignedOut(true);
      return null;
    }

    return await fetchSessionIdentity(headers);
  }

  console.error("Auth fetch failed:", response.status, response.statusText);

  // ✅ Si está forzado signed-out, no intentes Guest tampoco
  if (forcedSignedOut) return null;

  return await fetchSessionIdentity(headers);

}

// --- Provider Component ---

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isOAuthSyncing, setIsOAuthSyncing] = useState(false);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const search = typeof window !== "undefined" ? window.location.search : "";
  const authQueryEnabled = !shouldDeferAuthenticatedBootstrap(pathname, search);

  const { data: user, isLoading, isFetched, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    meta: { suppressGlobalErrorToast: true },
    retry: false,
    // Always re-validate on mount so a fresh server session is picked up after login redirects.
    refetchOnMount: "always",
    staleTime: 1000 * 30, // 30 seconds (faster updates in dev/OAuth flows)
    initialData: getStoredUser, // Hydrate from local storage initially
    refetchOnWindowFocus: true,
    enabled: authQueryEnabled,
  });

  const resolvedUser = authQueryEnabled ? (user ?? null) : null;
  const isAuthenticated = !!resolvedUser && !isAnonymousUser(resolvedUser);
  const isReady = (authQueryEnabled ? isFetched : true) && !isOAuthSyncing;

  const login = useCallback(() => {
    window.location.href = "/login";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore errors
    }
    setForcedSignedOut(true);
    clearAnonUserId();
    setStoredUser(null);
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    queryClient.clear();
    window.location.href = "/login?logged_out=1";
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    // Clear the cache to force a fresh fetch
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    // Force refetch immediately
    await refetch();
  }, [refetch, queryClient]);
  useEffect(() => {
    if (typeof window === "undefined") return;

    const forced = isForcedSignedOut();
    if (forced && !isPublicAuthRoute(window.location.pathname)) {
      window.location.replace("/login?logged_out=1");
    }
  }, []);


  // Handle OAuth Callback Logic
  useEffect(() => {
    if (typeof window === "undefined" || !hasOAuthSuccessMarker(window.location.search)) {
      return;
    }

    let cancelled = false;
    clearForcedSignedOutFlag();
    clearAnonUserId();
    setIsOAuthSyncing(true);

    const syncOAuthSession = async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await refetch();
        if (cancelled) return;

        const nextUser = result.data ?? null;
        if (nextUser && !isAnonymousUser(nextUser)) {
          setStoredUser(nextUser);
          setForcedSignedOut(false);

          // Preserve provider param from OAuth callback for client-side handling
          // (e.g. auto-trigger Gemini CLI connection after login).
          const params = new URLSearchParams(window.location.search);
          const provider = params.get("provider");
          if (provider) {
            window.history.replaceState({}, "", `${window.location.pathname}?provider=${provider}`);
          } else {
            window.history.replaceState({}, "", window.location.pathname);
          }
          setIsOAuthSyncing(false);
          return;
        }

        if (attempt < 3) {
          await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        }
      }

      if (cancelled) return;
      setIsOAuthSyncing(false);
      window.location.replace("/login?error=session_error");
    };

    void syncOAuthSession();

    return () => {
      cancelled = true;
    };
  }, [refetch, queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authQueryEnabled) return;

    window.dispatchEvent(
      new CustomEvent("auth:changed", {
        detail: {
          userId: resolvedUser?.id ?? null,
          isAuthenticated,
        },
      })
    );
  }, [authQueryEnabled, isAuthenticated, resolvedUser]);

  return (
    <AuthContext.Provider value={{
      user: resolvedUser,
      isLoading: authQueryEnabled ? isLoading : false,
      isReady,
      isAuthenticated,
      login,
      logout,
      refreshAuth
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// --- Hook ---

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

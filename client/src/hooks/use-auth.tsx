

import { createContext, ReactNode, useContext, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";

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

// --- Fetch Logic ---

async function fetchUser(): Promise<User | null> {
  const storedAnonId = getStoredAnonUserId();
  const headers: HeadersInit = {};
  if (storedAnonId) {
    headers['X-Anonymous-User-Id'] = storedAnonId;
  }

  const response = await fetch("/api/auth/user", {
    credentials: "include",
    headers,
  });

  if (response.ok) {
    const user = await response.json();
    setStoredUser(user);
    clearAnonUserId();
    return user;
  }

  const tryAnonymousIdentity = async (): Promise<User | null> => {
    try {
      const identityRes = await fetch("/api/session/identity", {
        credentials: "include",
        headers,
      });
      if (identityRes.ok) {
        const identity = await identityRes.json();
        if (identity.userId) {
          setStoredAnonUserId(identity.userId);
          if (identity.token) {
            setStoredAnonToken(identity.token);
          }
          return {
            id: identity.userId,
            isAnonymous: true,
            username: `Guest-${identity.userId.slice(0, 4)}`,
            role: 'user',
          } as User;
        }
      }
    } catch (e) {
      console.error("Failed to get session identity:", e);
    }
    return null;
  };

  if (response.status === 401 || response.status === 403) {
    clearOldUserData();
    return await tryAnonymousIdentity();
  }

  console.error("Auth fetch failed:", response.status, response.statusText);
  return await tryAnonymousIdentity();
}

// --- Provider Component ---

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, isFetched, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    // Always re-validate on mount so a fresh server session is picked up after login redirects.
    refetchOnMount: "always",
    staleTime: 1000 * 30, // 30 seconds (faster updates in dev/OAuth flows)
    initialData: getStoredUser, // Hydrate from local storage initially
    refetchOnWindowFocus: true,
  });

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
    setStoredUser(null);
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    queryClient.clear();
    window.location.href = "/welcome";
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    // Clear the cache to force a fresh fetch
    queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    // Force refetch immediately
    await refetch();
  }, [refetch, queryClient]);

  // Handle OAuth Callback Logic
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      // Invalidate cache to force fresh fetch
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Trigger a refetch to get the new user session
      refetch().then((result) => {
        if (result.data) {
          setStoredUser(result.data);
        } else {
          console.warn('[Auth] OAuth callback but no user data received');
        }
      });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch, queryClient]);

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      isReady: isFetched,
      isAuthenticated: !!user && !(user as any)?.isAnonymous,
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

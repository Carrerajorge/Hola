import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";

function getStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

function setStoredUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (e) {
    // Ignore storage errors
  }
}

function clearOldUserData(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    // Ignore storage errors
  }
}

export function getStoredAnonUserId(): string | null {
  try {
    return localStorage.getItem(ANON_USER_ID_KEY);
  } catch (e) {
    return null;
  }
}

function setStoredAnonUserId(id: string): void {
  try {
    localStorage.setItem(ANON_USER_ID_KEY, id);
  } catch (e) {
    // Ignore storage errors
  }
}

function clearAnonUserId(): void {
  try {
    localStorage.removeItem(ANON_USER_ID_KEY);
    localStorage.removeItem(ANON_TOKEN_KEY);
  } catch (e) {
    // Ignore storage errors
  }
}

export function getStoredAnonToken(): string | null {
  try {
    return localStorage.getItem(ANON_TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

function setStoredAnonToken(token: string): void {
  try {
    localStorage.setItem(ANON_TOKEN_KEY, token);
  } catch (e) {
    // Ignore storage errors
  }
}

function clearAnonToken(): void {
  try {
    localStorage.removeItem(ANON_TOKEN_KEY);
  } catch (e) {
    // Ignore storage errors
  }
}

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

  if (response.status === 401) {
    clearOldUserData();
    
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
          const anonUser = {
            id: identity.userId,
            email: null,
            isAnonymous: true
          };
          return anonUser as any;
        }
      }
    } catch (e) {
      console.error("Failed to get session identity:", e);
    }
    return null;
  }

  throw new Error(`${response.status}: ${response.statusText}`);
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const login = useCallback(() => {
    window.location.href = "/api/login";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      // Ignore errors, still clear local state
    }
    setStoredUser(null);
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    queryClient.clear();
    window.location.href = "/welcome";
  }, [queryClient]);

  const refreshAuth = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/models/available"] });
    refetch();
  }, [refetch, queryClient]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshAuth,
  };
}

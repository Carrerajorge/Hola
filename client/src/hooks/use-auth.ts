import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";

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

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    // Try localStorage fallback
    const storedUser = getStoredUser();
    if (storedUser) {
      return storedUser;
    }
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const user = await response.json();
  setStoredUser(user);
  return user;
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
    window.location.href = "/welcome";
  }, [queryClient]);

  const refreshAuth = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshAuth,
  };
}

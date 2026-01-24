import { createContext, ReactNode, useContext, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/schema";

const AUTH_STORAGE_KEY = "siragpt_auth_user";
const ANON_USER_ID_KEY = "siragpt_anon_user_id";
const ANON_TOKEN_KEY = "siragpt_anon_token";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
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

  if (response.status === 401) {
    clearOldUserData();

    try {
      // Attempt to get anonymous identity
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
          // Return a constructed anonymous user object conformant to User type
          // Note context: strict typing might need partial assertion or fuller mock
          return {
            id: identity.userId,
            isAnonymous: true,
            username: `Guest-${identity.userId.slice(0, 4)}`,
            role: 'user',
            // Add other required fields with defaults if necessary, or assume User type considers optional
          } as unknown as User;
        }
      }
    } catch (e) {
      console.error("Failed to get session identity:", e);
    }
    return null;
  }

  throw new Error(`${response.status}: ${response.statusText}`);
}

// --- Provider Component ---

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    initialData: getStoredUser, // Hydrate from local storage initially
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
    } catch {
      // Ignore errors
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

  // Handle OAuth Callback Logic
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      // Trigger a refetch to get the new user session
      refetch().then((result) => {
        if (result.data) {
          // Query update handles storage via fetchUser side-effects, 
          // but let's ensure consistency if needed.
          // Actually fetchUser already calls setStoredUser.
        }
      });
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch]);

  return (
    <AuthContext.Provider value={{
      user: user ?? null,
      isLoading,
      isAuthenticated: !!user,
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

import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    // Check if admin is logged in via localStorage (admin login fallback)
    const adminLoggedIn = localStorage.getItem("sira_admin_logged_in") === "true";
    if (adminLoggedIn) {
      return {
        id: "admin-user-id",
        email: localStorage.getItem("sira_admin_email") || "admin@gmail.com",
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
        role: "admin",
      } as User;
    }
    // Check if regular user is logged in via localStorage
    const userLoggedIn = localStorage.getItem("sira_logged_in") === "true";
    const userDataStr = localStorage.getItem("sira_user_data");
    if (userLoggedIn && userDataStr) {
      try {
        return JSON.parse(userDataStr) as User;
      } catch {
        localStorage.removeItem("sira_logged_in");
        localStorage.removeItem("sira_user_data");
      }
    }
    // Clear any stale login state
    localStorage.removeItem("sira_logged_in");
    localStorage.removeItem("sira_user_data");
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}

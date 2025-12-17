import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    // Check if user is logged in via localStorage (admin login)
    const localLoggedIn = localStorage.getItem("sira_logged_in") === "true";
    if (localLoggedIn) {
      // Return a mock admin user for localStorage-based auth
      return {
        id: "admin-user-id",
        email: "admin@gmail.com",
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
      } as User;
    }
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

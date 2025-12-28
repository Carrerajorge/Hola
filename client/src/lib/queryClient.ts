import { QueryClient, QueryFunction } from "@tanstack/react-query";

const AUTH_STORAGE_KEY = "siragpt_auth_user";

let isRedirecting = false;

function handleUnauthorized() {
  if (isRedirecting) return;
  
  const publicPaths = ['/login', '/signup', '/welcome', '/privacy'];
  const isPublicPath = publicPaths.some(path => window.location.pathname.startsWith(path));
  
  if (!isPublicPath) {
    isRedirecting = true;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.clear();
    window.location.href = '/login';
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      handleUnauthorized();
      throw new Error('Unauthorized');
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
      onError: (error) => {
        if (error instanceof Error && error.message.includes('401')) {
          handleUnauthorized();
        }
      },
    },
  },
});

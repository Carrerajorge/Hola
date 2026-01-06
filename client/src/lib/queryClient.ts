import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toast } from "sonner";

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

export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (error: Error, attempt: number) => {
    const status = parseInt(error.message.split(':')[0]);
    if ([401, 403, 404, 422].includes(status)) return false;
    if (status >= 400 && status < 500) return false;
    return attempt < 3;
  }
};

function calculateBackoffDelay(attempt: number, config: Required<RetryConfig>): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return Math.min(delay + jitter, config.maxDelayMs);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function apiRequestWithRetry(
  method: string,
  url: string,
  data?: unknown,
  config?: RetryConfig
): Promise<Response> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      if (!navigator.onLine) {
        throw new Error('offline: No internet connection');
      }
      
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

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }

      return res;
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < retryConfig.maxRetries && retryConfig.shouldRetry(lastError, attempt)) {
        const delay = calculateBackoffDelay(attempt, retryConfig);
        await sleep(delay);
        continue;
      }
      
      break;
    }
  }
  
  throw lastError;
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

function getReadableErrorMessage(error: string): string {
  if (error.includes('offline') || error.includes('Failed to fetch')) {
    return 'No internet connection';
  }
  if (error.includes('500') || error.includes('502') || error.includes('503')) {
    return 'Server temporarily unavailable';
  }
  if (error.includes('408') || error.includes('timeout')) {
    return 'Request timed out';
  }
  if (error.includes('429')) {
    return 'Too many requests, please wait';
  }
  if (error.includes('Network') || error.includes('network')) {
    return 'Network error occurred';
  }
  return 'Something went wrong';
}

export function showErrorToast(
  message: string,
  options?: { 
    onRetry?: () => void;
    description?: string;
  }
) {
  const toastMessage = getReadableErrorMessage(message);
  
  toast.error(toastMessage, {
    description: options?.description,
    duration: options?.onRetry ? 10000 : 5000,
    action: options?.onRetry ? {
      label: "Retry",
      onClick: options.onRetry
    } : undefined,
  });
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

function defaultRetryCondition(failureCount: number, error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  const status = parseInt(message.split(':')[0]);
  if ([401, 403, 404, 422].includes(status)) return false;
  if (status >= 400 && status < 500) return false;
  return failureCount < 3;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: defaultRetryCondition,
      retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
      throwOnError: (error) => {
        if (error instanceof Error) {
          const status = parseInt(error.message.split(':')[0]);
          if (status === 401) return false;
        }
        return false;
      },
    },
    mutations: {
      retry: defaultRetryCondition,
      retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
      onError: (error) => {
        if (error instanceof Error && error.message.includes('401')) {
          handleUnauthorized();
        }
      },
    },
  },
});

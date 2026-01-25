import { useRef, useEffect, useCallback } from 'react';

/**
 * Hook for managing AbortController with automatic cleanup
 * Prevents race conditions in async operations by aborting previous requests
 */
export function useAbortController() {
  const abortControllerRef = useRef<AbortController | null>(null);

  // Abort any pending request
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Get a new AbortController, aborting any previous one
  const getController = useCallback(() => {
    abort();
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current;
  }, [abort]);

  // Get the signal from the current controller
  const getSignal = useCallback(() => {
    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }
    return abortControllerRef.current.signal;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  return {
    getController,
    getSignal,
    abort,
  };
}

/**
 * Hook for making fetch requests with automatic abort on unmount
 */
export function useAbortableFetch<T>() {
  const { getController, abort } = useAbortController();
  const isActiveRef = useRef(true);

  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
      abort();
    };
  }, [abort]);

  const fetchData = useCallback(async (
    url: string,
    options?: RequestInit
  ): Promise<T | null> => {
    const controller = getController();

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (!isActiveRef.current) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!isActiveRef.current) {
        return null;
      }

      return data as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted, don't treat as error
        return null;
      }
      throw error;
    }
  }, [getController]);

  return {
    fetchData,
    abort,
    isActive: () => isActiveRef.current,
  };
}

/**
 * Utility to check if an error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Wrapper for async operations with abort support
 */
export async function withAbortSignal<T>(
  signal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> {
  if (signal.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }

  // Create a promise that rejects when signal is aborted
  const abortPromise = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('Operation aborted', 'AbortError'));
    });
  });

  return Promise.race([operation(), abortPromise]);
}

export default useAbortController;

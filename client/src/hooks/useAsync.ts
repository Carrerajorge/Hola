import { useState, useCallback, useEffect, useRef } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  status: AsyncStatus;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
}

export interface UseAsyncReturn<T, Args extends unknown[]> extends AsyncState<T> {
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
  setData: (data: T | null) => void;
}

/**
 * Hook for handling async operations with loading, error, and success states
 * Provides automatic cleanup on unmount and race condition prevention
 */
export function useAsync<T, Args extends unknown[] = []>(
  asyncFunction: (...args: Args) => Promise<T>,
  options: {
    immediate?: boolean;
    args?: Args;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  } = {}
): UseAsyncReturn<T, Args> {
  const { immediate = false, args, onSuccess, onError } = options;

  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    status: 'idle',
    isLoading: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
  });

  // Track mounted state and current request
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const execute = useCallback(async (...executeArgs: Args): Promise<T | null> => {
    // Increment request ID to handle race conditions
    const requestId = ++requestIdRef.current;

    setState({
      data: null,
      error: null,
      status: 'loading',
      isLoading: true,
      isError: false,
      isSuccess: false,
      isIdle: false,
    });

    try {
      const result = await asyncFunction(...executeArgs);

      // Only update if this is the most recent request and component is mounted
      if (requestId === requestIdRef.current && isMountedRef.current) {
        setState({
          data: result,
          error: null,
          status: 'success',
          isLoading: false,
          isError: false,
          isSuccess: true,
          isIdle: false,
        });
        onSuccess?.(result);
        return result;
      }
      return null;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      if (requestId === requestIdRef.current && isMountedRef.current) {
        setState({
          data: null,
          error: errorObj,
          status: 'error',
          isLoading: false,
          isError: true,
          isSuccess: false,
          isIdle: false,
        });
        onError?.(errorObj);
      }
      return null;
    }
  }, [asyncFunction, onSuccess, onError]);

  const reset = useCallback(() => {
    requestIdRef.current++;
    setState({
      data: null,
      error: null,
      status: 'idle',
      isLoading: false,
      isError: false,
      isSuccess: false,
      isIdle: true,
    });
  }, []);

  const setData = useCallback((data: T | null) => {
    setState(prev => ({
      ...prev,
      data,
      status: data !== null ? 'success' : prev.status,
      isSuccess: data !== null,
    }));
  }, []);

  // Run immediately if requested
  useEffect(() => {
    if (immediate && args) {
      execute(...args);
    }
  }, [immediate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    ...state,
    execute,
    reset,
    setData,
  };
}

/**
 * Hook for fetching data with automatic retry on failure
 */
export function useAsyncWithRetry<T, Args extends unknown[] = []>(
  asyncFunction: (...args: Args) => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    exponentialBackoff?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  } = {}
): UseAsyncReturn<T, Args> & { retryCount: number } {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    exponentialBackoff = true,
    onSuccess,
    onError,
  } = options;

  const [retryCount, setRetryCount] = useState(0);

  const asyncWithRetry = useCallback(async (...args: Args): Promise<T> => {
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= maxRetries) {
      try {
        const result = await asyncFunction(...args);
        setRetryCount(0);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts++;
        setRetryCount(attempts);

        if (attempts <= maxRetries) {
          const delay = exponentialBackoff
            ? retryDelay * Math.pow(2, attempts - 1)
            : retryDelay;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }, [asyncFunction, maxRetries, retryDelay, exponentialBackoff]);

  const asyncHook = useAsync(asyncWithRetry, { onSuccess, onError });

  return {
    ...asyncHook,
    retryCount,
  };
}

/**
 * Hook for polling data at intervals
 */
export function useAsyncPolling<T>(
  asyncFunction: () => Promise<T>,
  options: {
    interval?: number;
    enabled?: boolean;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;
  } = {}
): UseAsyncReturn<T, []> & { startPolling: () => void; stopPolling: () => void } {
  const { interval = 5000, enabled = true, onSuccess, onError } = options;

  const asyncHook = useAsync(asyncFunction, { onSuccess, onError });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isPolling, setIsPolling] = useState(enabled);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    setIsPolling(true);
    asyncHook.execute();
    intervalRef.current = setInterval(() => {
      asyncHook.execute();
    }, interval);
  }, [asyncHook, interval, stopPolling]);

  useEffect(() => {
    if (enabled && isPolling) {
      startPolling();
    }
    return stopPolling;
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...asyncHook,
    startPolling,
    stopPolling,
  };
}

/**
 * Hook for managing multiple async operations
 */
export function useAsyncQueue<T>(): {
  queue: Array<{ id: string; status: AsyncStatus; error: Error | null }>;
  add: (id: string, asyncFn: () => Promise<T>) => Promise<T | null>;
  remove: (id: string) => void;
  clear: () => void;
  isProcessing: boolean;
} {
  const [queue, setQueue] = useState<
    Array<{ id: string; status: AsyncStatus; error: Error | null }>
  >([]);

  const add = useCallback(async (id: string, asyncFn: () => Promise<T>): Promise<T | null> => {
    setQueue(prev => [...prev, { id, status: 'loading', error: null }]);

    try {
      const result = await asyncFn();
      setQueue(prev =>
        prev.map(item =>
          item.id === id ? { ...item, status: 'success' } : item
        )
      );
      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      setQueue(prev =>
        prev.map(item =>
          item.id === id ? { ...item, status: 'error', error: errorObj } : item
        )
      );
      return null;
    }
  }, []);

  const remove = useCallback((id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setQueue([]);
  }, []);

  const isProcessing = queue.some(item => item.status === 'loading');

  return { queue, add, remove, clear, isProcessing };
}

export default useAsync;

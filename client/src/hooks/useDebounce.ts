import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Hook that returns a debounced value
 * The value only updates after the specified delay has passed without changes
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook that returns a debounced callback function
 * The callback only fires after the specified delay has passed without being called
 */
export function useDebouncedCallback<Args extends unknown[], R>(
  callback: (...args: Args) => R,
  delay: number,
  deps: React.DependencyList = []
): (...args: Args) => void {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useCallback((...args: Args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay, ...deps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * Hook that returns a throttled callback function
 * The callback only fires at most once per specified interval
 */
export function useThrottledCallback<Args extends unknown[], R>(
  callback: (...args: Args) => R,
  limit: number,
  deps: React.DependencyList = []
): (...args: Args) => void {
  const lastRunRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);
  const lastArgsRef = useRef<Args | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const throttledCallback = useCallback((...args: Args) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRunRef.current;

    lastArgsRef.current = args;

    if (timeSinceLastRun >= limit) {
      // Run immediately if enough time has passed
      lastRunRef.current = now;
      callbackRef.current(...args);
    } else {
      // Schedule for later
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        if (lastArgsRef.current) {
          callbackRef.current(...lastArgsRef.current);
        }
      }, limit - timeSinceLastRun);
    }
  }, [limit, ...deps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return throttledCallback;
}

/**
 * Hook that returns a throttled value
 * The value only updates at most once per specified interval
 */
export function useThrottle<T>(value: T, limit: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastRunRef = useRef(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRunRef.current;

    if (timeSinceLastRun >= limit) {
      lastRunRef.current = now;
      setThrottledValue(value);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        lastRunRef.current = Date.now();
        setThrottledValue(value);
      }, limit - timeSinceLastRun);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, limit]);

  return throttledValue;
}

/**
 * Hook for debounced search input
 * Returns the input value, debounced value, and a setter
 */
export function useDebouncedSearch(initialValue: string = '', delay: number = 300) {
  const [inputValue, setInputValue] = useState(initialValue);
  const debouncedValue = useDebounce(inputValue, delay);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  const clear = useCallback(() => {
    setInputValue('');
  }, []);

  return {
    inputValue,
    debouncedValue,
    setInputValue,
    handleChange,
    clear,
    isSearching: inputValue !== debouncedValue,
  };
}

/**
 * Alias for useDebounce for consistency with the naming pattern
 */
export const useDebouncedValue = useDebounce;

export default useDebounce;

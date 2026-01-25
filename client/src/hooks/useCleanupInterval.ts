import { useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook for safe interval management with automatic cleanup
 * Prevents memory leaks by automatically clearing intervals on unmount
 */
export function useCleanupInterval() {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);

  // Clear any existing interval
  const clearCurrentInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Set a new interval with automatic cleanup
  const setCleanupInterval = useCallback((callback: () => void, delay: number) => {
    clearCurrentInterval();

    if (isActiveRef.current) {
      intervalRef.current = setInterval(() => {
        if (isActiveRef.current) {
          callback();
        }
      }, delay);
    }

    return intervalRef.current;
  }, [clearCurrentInterval]);

  // Cleanup on unmount
  useEffect(() => {
    isActiveRef.current = true;

    return () => {
      isActiveRef.current = false;
      clearCurrentInterval();
    };
  }, [clearCurrentInterval]);

  return {
    setInterval: setCleanupInterval,
    clearInterval: clearCurrentInterval,
    isActive: () => isActiveRef.current,
  };
}

/**
 * Custom hook for safe timeout management with automatic cleanup
 */
export function useCleanupTimeout() {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);

  const clearCurrentTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const setCleanupTimeout = useCallback((callback: () => void, delay: number) => {
    clearCurrentTimeout();

    if (isActiveRef.current) {
      timeoutRef.current = setTimeout(() => {
        if (isActiveRef.current) {
          callback();
        }
      }, delay);
    }

    return timeoutRef.current;
  }, [clearCurrentTimeout]);

  useEffect(() => {
    isActiveRef.current = true;

    return () => {
      isActiveRef.current = false;
      clearCurrentTimeout();
    };
  }, [clearCurrentTimeout]);

  return {
    setTimeout: setCleanupTimeout,
    clearTimeout: clearCurrentTimeout,
    isActive: () => isActiveRef.current,
  };
}

/**
 * Custom hook for safe requestAnimationFrame with cleanup
 */
export function useCleanupAnimationFrame() {
  const frameRef = useRef<number | null>(null);
  const isActiveRef = useRef(true);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const requestFrame = useCallback((callback: FrameRequestCallback) => {
    cancelFrame();

    if (isActiveRef.current) {
      frameRef.current = requestAnimationFrame((time) => {
        if (isActiveRef.current) {
          callback(time);
        }
      });
    }

    return frameRef.current;
  }, [cancelFrame]);

  useEffect(() => {
    isActiveRef.current = true;

    return () => {
      isActiveRef.current = false;
      cancelFrame();
    };
  }, [cancelFrame]);

  return {
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    isActive: () => isActiveRef.current,
  };
}

/**
 * Hook to run a polling function with automatic cleanup
 */
export function usePolling(
  callback: () => void | Promise<void>,
  interval: number,
  enabled: boolean = true
) {
  const { setInterval: setCleanupInterval, clearInterval } = useCleanupInterval();
  const callbackRef = useRef(callback);

  // Keep callback ref updated
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      clearInterval();
      return;
    }

    // Run immediately
    callbackRef.current();

    // Then run on interval
    setCleanupInterval(() => {
      callbackRef.current();
    }, interval);

    return clearInterval;
  }, [enabled, interval, setCleanupInterval, clearInterval]);
}

export default useCleanupInterval;

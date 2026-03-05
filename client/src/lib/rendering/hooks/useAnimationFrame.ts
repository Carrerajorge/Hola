/**
 * Hook: useAnimationFrame
 * Provides a requestAnimationFrame loop with delta time
 */

import { useRef, useEffect, useCallback } from 'react';

interface AnimationFrameCallback {
  (deltaTime: number, elapsed: number): void;
}

interface UseAnimationFrameOptions {
  fps?: number; // Target FPS (0 = unlimited)
  active?: boolean;
}

export function useAnimationFrame(
  callback: AnimationFrameCallback,
  options: UseAnimationFrameOptions = {}
) {
  const { fps = 0, active = true } = options;
  const callbackRef = useRef(callback);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const previousTimeRef = useRef(0);
  const frameInterval = fps > 0 ? 1000 / fps : 0;

  callbackRef.current = callback;

  const animate = useCallback(
    (time: number) => {
      if (!startTimeRef.current) startTimeRef.current = time;
      const elapsed = time - startTimeRef.current;
      const deltaTime = time - previousTimeRef.current;

      if (frameInterval === 0 || deltaTime >= frameInterval) {
        callbackRef.current(deltaTime / 1000, elapsed / 1000);
        previousTimeRef.current = time;
      }

      frameRef.current = requestAnimationFrame(animate);
    },
    [frameInterval]
  );

  useEffect(() => {
    if (active) {
      previousTimeRef.current = performance.now();
      frameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [active, animate]);

  const stop = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
  }, []);

  const reset = useCallback(() => {
    startTimeRef.current = 0;
    previousTimeRef.current = 0;
  }, []);

  return { stop, reset };
}

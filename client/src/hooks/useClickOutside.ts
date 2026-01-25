import { useEffect, useRef, useCallback, RefObject } from 'react';

/**
 * Hook for detecting clicks outside of a referenced element
 * Useful for closing dropdowns, modals, and menus
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  options: {
    enabled?: boolean;
    eventType?: 'mousedown' | 'mouseup' | 'click';
    ignoreRefs?: RefObject<HTMLElement>[];
  } = {}
): RefObject<T> {
  const { enabled = true, eventType = 'mousedown', ignoreRefs = [] } = options;
  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);

  // Keep handler reference updated
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      // Check if click is inside the main ref
      if (ref.current?.contains(target)) {
        return;
      }

      // Check if click is inside any of the ignore refs
      for (const ignoreRef of ignoreRefs) {
        if (ignoreRef.current?.contains(target)) {
          return;
        }
      }

      // Click was outside, call handler
      handlerRef.current();
    };

    // Use capture phase to handle the event before it bubbles
    document.addEventListener(eventType, handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);

    return () => {
      document.removeEventListener(eventType, handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
    };
  }, [enabled, eventType, ignoreRefs]);

  return ref;
}

/**
 * Hook for detecting clicks outside of multiple elements
 * All refs must be clicked outside for the handler to trigger
 */
export function useClickOutsideMultiple(
  refs: RefObject<HTMLElement>[],
  handler: () => void,
  enabled: boolean = true
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      // Check if click is inside any of the refs
      const isInsideAny = refs.some(ref => ref.current?.contains(target));

      if (!isInsideAny) {
        handlerRef.current();
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
    };
  }, [refs, enabled]);
}

/**
 * Hook that combines click outside with escape key press
 * Common pattern for closing modals and dropdowns
 */
export function useClickOutsideOrEscape<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled: boolean = true
): RefObject<T> {
  const ref = useClickOutside<T>(handler, { enabled });

  useEffect(() => {
    if (!enabled) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handler();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handler, enabled]);

  return ref;
}

export default useClickOutside;

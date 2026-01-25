import { useCallback, useEffect, useRef, useState } from 'react';

type NavigationDirection = 'horizontal' | 'vertical' | 'both';

interface KeyboardNavigationOptions {
  direction?: NavigationDirection;
  loop?: boolean;
  enabled?: boolean;
  onSelect?: (index: number) => void;
  onEscape?: () => void;
  initialIndex?: number;
}

/**
 * Hook for keyboard navigation through a list of items
 * Supports arrow keys, Home, End, and Enter/Space for selection
 */
export function useKeyboardNavigation(
  itemCount: number,
  options: KeyboardNavigationOptions = {}
) {
  const {
    direction = 'vertical',
    loop = true,
    enabled = true,
    onSelect,
    onEscape,
    initialIndex = -1,
  } = options;

  const [focusedIndex, setFocusedIndex] = useState(initialIndex);
  const containerRef = useRef<HTMLElement | null>(null);

  const moveNext = useCallback(() => {
    setFocusedIndex(prev => {
      if (prev >= itemCount - 1) {
        return loop ? 0 : prev;
      }
      return prev + 1;
    });
  }, [itemCount, loop]);

  const movePrev = useCallback(() => {
    setFocusedIndex(prev => {
      if (prev <= 0) {
        return loop ? itemCount - 1 : prev;
      }
      return prev - 1;
    });
  }, [itemCount, loop]);

  const moveToFirst = useCallback(() => {
    setFocusedIndex(0);
  }, []);

  const moveToLast = useCallback(() => {
    setFocusedIndex(itemCount - 1);
  }, [itemCount]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    const isHorizontal = direction === 'horizontal' || direction === 'both';
    const isVertical = direction === 'vertical' || direction === 'both';

    switch (event.key) {
      case 'ArrowDown':
        if (isVertical) {
          event.preventDefault();
          moveNext();
        }
        break;

      case 'ArrowUp':
        if (isVertical) {
          event.preventDefault();
          movePrev();
        }
        break;

      case 'ArrowRight':
        if (isHorizontal) {
          event.preventDefault();
          moveNext();
        }
        break;

      case 'ArrowLeft':
        if (isHorizontal) {
          event.preventDefault();
          movePrev();
        }
        break;

      case 'Home':
        event.preventDefault();
        moveToFirst();
        break;

      case 'End':
        event.preventDefault();
        moveToLast();
        break;

      case 'Enter':
      case ' ':
        if (focusedIndex >= 0 && focusedIndex < itemCount) {
          event.preventDefault();
          onSelect?.(focusedIndex);
        }
        break;

      case 'Escape':
        event.preventDefault();
        onEscape?.();
        break;
    }
  }, [
    enabled,
    direction,
    focusedIndex,
    itemCount,
    moveNext,
    movePrev,
    moveToFirst,
    moveToLast,
    onSelect,
    onEscape,
  ]);

  // Attach keyboard listener
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }

    // Fallback to document if no container
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  // Reset focus when item count changes
  useEffect(() => {
    if (focusedIndex >= itemCount) {
      setFocusedIndex(itemCount > 0 ? itemCount - 1 : -1);
    }
  }, [itemCount, focusedIndex]);

  return {
    focusedIndex,
    setFocusedIndex,
    containerRef,
    getItemProps: (index: number) => ({
      'aria-selected': focusedIndex === index,
      'data-focused': focusedIndex === index,
      tabIndex: focusedIndex === index ? 0 : -1,
      onFocus: () => setFocusedIndex(index),
    }),
    moveNext,
    movePrev,
    moveToFirst,
    moveToLast,
  };
}

/**
 * Hook for typeahead/search navigation
 * Allows users to type to jump to matching items
 */
export function useTypeaheadNavigation<T>(
  items: T[],
  getLabel: (item: T) => string,
  onMatch: (index: number) => void,
  options: { enabled?: boolean; timeout?: number } = {}
) {
  const { enabled = true, timeout = 500 } = options;
  const searchBufferRef = useRef('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Only handle printable characters
    if (event.key.length !== 1) return;

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Add character to buffer
    searchBufferRef.current += event.key.toLowerCase();

    // Find matching item
    const matchIndex = items.findIndex(item =>
      getLabel(item).toLowerCase().startsWith(searchBufferRef.current)
    );

    if (matchIndex >= 0) {
      onMatch(matchIndex);
    }

    // Clear buffer after timeout
    timeoutRef.current = setTimeout(() => {
      searchBufferRef.current = '';
    }, timeout);
  }, [enabled, items, getLabel, onMatch, timeout]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keypress', handleKeyPress);
    return () => {
      document.removeEventListener('keypress', handleKeyPress);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, handleKeyPress]);

  return {
    clearSearch: () => {
      searchBufferRef.current = '';
    },
  };
}

/**
 * Hook for roving tabindex pattern
 * Manages tab focus within a group of elements
 */
export function useRovingTabIndex(
  itemCount: number,
  options: {
    initialIndex?: number;
    vertical?: boolean;
    loop?: boolean;
  } = {}
) {
  const { initialIndex = 0, vertical = true, loop = true } = options;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const focusItem = useCallback((index: number) => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  }, []);

  const getItemProps = useCallback((index: number) => ({
    ref: (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    tabIndex: index === activeIndex ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent) => {
      const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
      const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';

      if (event.key === nextKey) {
        event.preventDefault();
        const nextIndex = loop
          ? (index + 1) % itemCount
          : Math.min(index + 1, itemCount - 1);
        focusItem(nextIndex);
      } else if (event.key === prevKey) {
        event.preventDefault();
        const prevIndex = loop
          ? (index - 1 + itemCount) % itemCount
          : Math.max(index - 1, 0);
        focusItem(prevIndex);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusItem(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusItem(itemCount - 1);
      }
    },
    onFocus: () => setActiveIndex(index),
  }), [activeIndex, itemCount, vertical, loop, focusItem]);

  return {
    activeIndex,
    setActiveIndex,
    focusItem,
    getItemProps,
  };
}

/**
 * Commonly used keyboard shortcuts hook
 */
export function useKeyboardShortcuts(
  shortcuts: Record<string, () => void>,
  options: { enabled?: boolean; preventDefault?: boolean } = {}
) {
  const { enabled = true, preventDefault = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Build shortcut key from event
      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push('ctrl');
      if (event.altKey) parts.push('alt');
      if (event.shiftKey) parts.push('shift');
      parts.push(event.key.toLowerCase());

      const shortcutKey = parts.join('+');

      if (shortcuts[shortcutKey]) {
        if (preventDefault) {
          event.preventDefault();
        }
        shortcuts[shortcutKey]();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled, preventDefault]);
}

export default useKeyboardNavigation;

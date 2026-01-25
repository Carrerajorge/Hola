import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for trapping focus within a container (useful for modals)
 * Implements proper focus management for accessibility
 */
export function useFocusTrap(isActive: boolean = true) {
  const containerRef = useRef<HTMLElement | null>(null);
  const previousActiveElementRef = useRef<Element | null>(null);

  // Get all focusable elements within the container
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];

    const focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(', ');

    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(focusableSelectors)
    ).filter(el => {
      // Ensure element is visible
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, []);

  // Focus the first focusable element
  const focusFirst = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[0].focus();
    }
  }, [getFocusableElements]);

  // Focus the last focusable element
  const focusLast = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[elements.length - 1].focus();
    }
  }, [getFocusableElements]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!isActive || event.key !== 'Tab') return;

    const elements = getFocusableElements();
    if (elements.length === 0) return;

    const firstElement = elements[0];
    const lastElement = elements[elements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      // Shift + Tab: go backwards
      if (activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: go forwards
      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }, [isActive, getFocusableElements]);

  // Set up the focus trap
  useEffect(() => {
    if (!isActive) return;

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement;

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Focus the first element after a brief delay (for animations)
    const timeoutId = setTimeout(focusFirst, 50);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeoutId);

      // Restore focus to the previous element
      if (previousActiveElementRef.current instanceof HTMLElement) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isActive, handleKeyDown, focusFirst]);

  // Ref callback to set the container
  const setContainerRef = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
  }, []);

  return {
    ref: setContainerRef,
    focusFirst,
    focusLast,
    getFocusableElements,
  };
}

/**
 * Hook for managing focus restoration
 * Restores focus to a previous element when a component unmounts
 */
export function useFocusRestoration(shouldRestore: boolean = true) {
  const previousElementRef = useRef<Element | null>(null);

  useEffect(() => {
    if (shouldRestore) {
      previousElementRef.current = document.activeElement;
    }

    return () => {
      if (shouldRestore && previousElementRef.current instanceof HTMLElement) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          if (previousElementRef.current instanceof HTMLElement) {
            previousElementRef.current.focus();
          }
        });
      }
    };
  }, [shouldRestore]);
}

/**
 * Hook for roving tabindex pattern
 * Useful for toolbar and menu navigation
 */
export function useRovingTabIndex(itemCount: number, initialIndex: number = 0) {
  const currentIndexRef = useRef(initialIndex);

  const handleKeyDown = useCallback((
    event: React.KeyboardEvent,
    itemRefs: React.RefObject<HTMLElement>[]
  ) => {
    const { key } = event;
    let newIndex = currentIndexRef.current;

    switch (key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        newIndex = (currentIndexRef.current + 1) % itemCount;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = (currentIndexRef.current - 1 + itemCount) % itemCount;
        break;
      case 'Home':
        event.preventDefault();
        newIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        newIndex = itemCount - 1;
        break;
      default:
        return;
    }

    currentIndexRef.current = newIndex;
    itemRefs[newIndex]?.current?.focus();
  }, [itemCount]);

  const getTabIndex = useCallback((index: number) => {
    return index === currentIndexRef.current ? 0 : -1;
  }, []);

  const setCurrentIndex = useCallback((index: number) => {
    currentIndexRef.current = index;
  }, []);

  return {
    handleKeyDown,
    getTabIndex,
    setCurrentIndex,
    currentIndex: currentIndexRef.current,
  };
}

export default useFocusTrap;

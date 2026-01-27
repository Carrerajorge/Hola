/**
 * UX & Accessibility Enhancements (241-260)
 * User experience improvements and accessibility features
 */

import { useState, useCallback, useEffect, useRef, createContext, useContext } from 'react';

// ============================================
// 241. Focus Trap Manager
// ============================================
export function useFocusTrap(containerRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef]);
}

// ============================================
// 242. Screen Reader Announcer
// ============================================
class ScreenReaderAnnouncer {
  private static instance: ScreenReaderAnnouncer;
  private liveRegion: HTMLElement | null = null;
  private assertiveRegion: HTMLElement | null = null;

  private constructor() {
    if (typeof document !== 'undefined') {
      this.liveRegion = this.createRegion('polite');
      this.assertiveRegion = this.createRegion('assertive');
    }
  }

  static getInstance(): ScreenReaderAnnouncer {
    if (!ScreenReaderAnnouncer.instance) {
      ScreenReaderAnnouncer.instance = new ScreenReaderAnnouncer();
    }
    return ScreenReaderAnnouncer.instance;
  }

  private createRegion(politeness: 'polite' | 'assertive'): HTMLElement {
    const region = document.createElement('div');
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('role', 'status');
    region.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(region);
    return region;
  }

  announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
    const region = priority === 'assertive' ? this.assertiveRegion : this.liveRegion;
    if (region) {
      region.textContent = '';
      setTimeout(() => {
        region.textContent = message;
      }, 100);
    }
  }
}

export const announcer = ScreenReaderAnnouncer.getInstance();

export function useAnnounce() {
  return useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    announcer.announce(message, priority);
  }, []);
}

// ============================================
// 243. Skip Links Component
// ============================================
interface SkipLink {
  id: string;
  label: string;
}

export function useSkipLinks(links: SkipLink[]) {
  const [visible, setVisible] = useState(false);

  const handleFocus = useCallback(() => setVisible(true), []);
  const handleBlur = useCallback(() => setVisible(false), []);

  const skipLinkProps = {
    onFocus: handleFocus,
    onBlur: handleBlur,
    className: visible ? 'skip-links visible' : 'skip-links',
  };

  const skipToTarget = useCallback((targetId: string) => {
    const target = document.getElementById(targetId);
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return { visible, skipLinkProps, skipToTarget, links };
}

// ============================================
// 244. Reduced Motion Preference
// ============================================
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return reducedMotion;
}

// ============================================
// 245. High Contrast Mode Detection
// ============================================
export function useHighContrast(): boolean {
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-contrast: more)').matches ||
           window.matchMedia('(-ms-high-contrast: active)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-contrast: more)');

    const handleChange = (event: MediaQueryListEvent) => {
      setHighContrast(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return highContrast;
}

// ============================================
// 246. Focus Visible Polyfill
// ============================================
export function useFocusVisible() {
  const [focusVisible, setFocusVisible] = useState(false);
  const [hadKeyboardEvent, setHadKeyboardEvent] = useState(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Escape') {
        setHadKeyboardEvent(true);
      }
    };

    const handlePointerDown = () => {
      setHadKeyboardEvent(false);
    };

    const handleFocus = () => {
      if (hadKeyboardEvent) {
        setFocusVisible(true);
      }
    };

    const handleBlur = () => {
      setFocusVisible(false);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    document.addEventListener('focus', handleFocus, true);
    document.addEventListener('blur', handleBlur, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
      document.removeEventListener('focus', handleFocus, true);
      document.removeEventListener('blur', handleBlur, true);
    };
  }, [hadKeyboardEvent]);

  return focusVisible;
}

// ============================================
// 247. ARIA Live Region Manager
// ============================================
type AriaLiveStatus = 'off' | 'polite' | 'assertive';

interface LiveRegion {
  id: string;
  message: string;
  politeness: AriaLiveStatus;
  timestamp: number;
}

class AriaLiveManager {
  private regions: Map<string, LiveRegion> = new Map();
  private listeners: Set<() => void> = new Set();

  update(id: string, message: string, politeness: AriaLiveStatus = 'polite'): void {
    this.regions.set(id, {
      id,
      message,
      politeness,
      timestamp: Date.now(),
    });
    this.notify();
  }

  clear(id: string): void {
    this.regions.delete(id);
    this.notify();
  }

  getRegions(): LiveRegion[] {
    return Array.from(this.regions.values());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const ariaLiveManager = new AriaLiveManager();

export function useAriaLive(id: string) {
  const update = useCallback(
    (message: string, politeness: AriaLiveStatus = 'polite') => {
      ariaLiveManager.update(id, message, politeness);
    },
    [id]
  );

  const clear = useCallback(() => {
    ariaLiveManager.clear(id);
  }, [id]);

  return { update, clear };
}

// ============================================
// 248. Roving Tab Index
// ============================================
export function useRovingTabIndex<T extends HTMLElement>(
  items: React.RefObject<T>[],
  options: { orientation?: 'horizontal' | 'vertical' | 'both'; loop?: boolean } = {}
) {
  const { orientation = 'horizontal', loop = true } = options;
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const { key } = event;
    const isHorizontal = orientation === 'horizontal' || orientation === 'both';
    const isVertical = orientation === 'vertical' || orientation === 'both';

    let nextIndex: number | null = null;

    if ((key === 'ArrowRight' && isHorizontal) || (key === 'ArrowDown' && isVertical)) {
      nextIndex = activeIndex + 1;
      if (nextIndex >= items.length) {
        nextIndex = loop ? 0 : items.length - 1;
      }
    } else if ((key === 'ArrowLeft' && isHorizontal) || (key === 'ArrowUp' && isVertical)) {
      nextIndex = activeIndex - 1;
      if (nextIndex < 0) {
        nextIndex = loop ? items.length - 1 : 0;
      }
    } else if (key === 'Home') {
      nextIndex = 0;
    } else if (key === 'End') {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== null && nextIndex !== activeIndex) {
      event.preventDefault();
      setActiveIndex(nextIndex);
      items[nextIndex]?.current?.focus();
    }
  }, [activeIndex, items, loop, orientation]);

  const getTabIndex = useCallback((index: number) => {
    return index === activeIndex ? 0 : -1;
  }, [activeIndex]);

  return { activeIndex, setActiveIndex, handleKeyDown, getTabIndex };
}

// ============================================
// 249. Color Blind Safe Palette
// ============================================
export const colorBlindSafePalette = {
  // Deuteranopia/Protanopia safe
  blue: '#0072B2',
  orange: '#E69F00',
  cyan: '#56B4E9',
  green: '#009E73',
  yellow: '#F0E442',
  vermillion: '#D55E00',
  pink: '#CC79A7',

  // Status colors that work for most color blindness types
  success: '#009E73',
  warning: '#E69F00',
  error: '#D55E00',
  info: '#0072B2',
};

export function useColorBlindMode(): 'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia' {
  const [mode, setMode] = useState<'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia'>('normal');

  useEffect(() => {
    // Check localStorage for user preference
    const saved = localStorage.getItem('colorBlindMode');
    if (saved) {
      setMode(saved as any);
    }
  }, []);

  return mode;
}

// ============================================
// 250. Touch Target Size Validator
// ============================================
interface TouchTargetValidation {
  valid: boolean;
  width: number;
  height: number;
  minSize: number;
  recommendation: string;
}

export function useTouchTargetValidator(
  elementRef: React.RefObject<HTMLElement>,
  minSize: number = 44 // WCAG minimum 44x44px
): TouchTargetValidation | null {
  const [validation, setValidation] = useState<TouchTargetValidation | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        const valid = width >= minSize && height >= minSize;

        setValidation({
          valid,
          width,
          height,
          minSize,
          recommendation: valid
            ? 'Touch target meets accessibility guidelines'
            : `Increase size to at least ${minSize}x${minSize}px for accessibility`,
        });
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef, minSize]);

  return validation;
}

// ============================================
// 251. Text Spacing Enhancement
// ============================================
interface TextSpacingOptions {
  lineHeight?: number; // multiplier of font-size
  letterSpacing?: number; // em units
  wordSpacing?: number; // em units
  paragraphSpacing?: number; // em units
}

export function useTextSpacing(options: TextSpacingOptions = {}) {
  const {
    lineHeight = 1.5,
    letterSpacing = 0.12,
    wordSpacing = 0.16,
    paragraphSpacing = 2,
  } = options;

  return {
    style: {
      lineHeight,
      letterSpacing: `${letterSpacing}em`,
      wordSpacing: `${wordSpacing}em`,
    },
    paragraphStyle: {
      marginBottom: `${paragraphSpacing}em`,
    },
  };
}

// ============================================
// 252. Keyboard Navigation Helper
// ============================================
interface KeyboardNavigation {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  getItemProps: (index: number) => {
    tabIndex: number;
    'aria-selected': boolean;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
}

export function useKeyboardNavigation(
  itemCount: number,
  onSelect?: (index: number) => void
): KeyboardNavigation {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        setCurrentIndex((prev) => (prev + 1) % itemCount);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        setCurrentIndex((prev) => (prev - 1 + itemCount) % itemCount);
        break;
      case 'Home':
        event.preventDefault();
        setCurrentIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setCurrentIndex(itemCount - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect?.(currentIndex);
        break;
    }
  }, [itemCount, currentIndex, onSelect]);

  const getItemProps = useCallback((index: number) => ({
    tabIndex: index === currentIndex ? 0 : -1,
    'aria-selected': index === currentIndex,
    onKeyDown: handleKeyDown,
  }), [currentIndex, handleKeyDown]);

  return { currentIndex, setCurrentIndex, handleKeyDown, getItemProps };
}

// ============================================
// 253. Form Field Validation Announcer
// ============================================
interface FieldValidation {
  isValid: boolean;
  errorMessage?: string;
  warningMessage?: string;
}

export function useFieldValidationAnnounce(
  fieldName: string,
  validation: FieldValidation
) {
  const announce = useAnnounce();
  const prevValidation = useRef<FieldValidation>();

  useEffect(() => {
    if (prevValidation.current?.isValid === validation.isValid) return;

    if (!validation.isValid && validation.errorMessage) {
      announce(`${fieldName}: ${validation.errorMessage}`, 'assertive');
    } else if (validation.warningMessage) {
      announce(`${fieldName}: ${validation.warningMessage}`, 'polite');
    }

    prevValidation.current = validation;
  }, [validation, fieldName, announce]);

  return {
    'aria-invalid': !validation.isValid,
    'aria-describedby': validation.errorMessage ? `${fieldName}-error` : undefined,
  };
}

// ============================================
// 254. Loading State Announcer
// ============================================
export function useLoadingAnnounce(
  isLoading: boolean,
  loadingMessage: string = 'Loading...',
  completeMessage: string = 'Content loaded'
) {
  const announce = useAnnounce();
  const wasLoading = useRef(false);

  useEffect(() => {
    if (isLoading && !wasLoading.current) {
      announce(loadingMessage, 'polite');
    } else if (!isLoading && wasLoading.current) {
      announce(completeMessage, 'polite');
    }
    wasLoading.current = isLoading;
  }, [isLoading, loadingMessage, completeMessage, announce]);
}

// ============================================
// 255. Auto-Dismiss Timer with Pause
// ============================================
export function useAutoDismiss(
  duration: number,
  onDismiss: () => void,
  options: { pauseOnHover?: boolean; pauseOnFocus?: boolean } = {}
) {
  const { pauseOnHover = true, pauseOnFocus = true } = options;
  const [isPaused, setIsPaused] = useState(false);
  const [remaining, setRemaining] = useState(duration);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return;
    }

    startTime.current = Date.now();
    timerRef.current = setTimeout(onDismiss, remaining);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPaused, remaining, onDismiss]);

  const pause = useCallback(() => {
    const elapsed = Date.now() - startTime.current;
    setRemaining((prev) => Math.max(0, prev - elapsed));
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    setIsPaused(false);
  }, []);

  const containerProps = {
    onMouseEnter: pauseOnHover ? pause : undefined,
    onMouseLeave: pauseOnHover ? resume : undefined,
    onFocus: pauseOnFocus ? pause : undefined,
    onBlur: pauseOnFocus ? resume : undefined,
  };

  return { isPaused, remaining, pause, resume, containerProps };
}

// ============================================
// 256. Scroll Position Memory
// ============================================
export function useScrollRestoration(key: string) {
  const scrollPositions = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // Restore scroll position
    const saved = scrollPositions.current.get(key);
    if (saved !== undefined) {
      window.scrollTo(0, saved);
    }

    // Save scroll position on unmount
    return () => {
      scrollPositions.current.set(key, window.scrollY);
    };
  }, [key]);

  const savePosition = useCallback(() => {
    scrollPositions.current.set(key, window.scrollY);
  }, [key]);

  return { savePosition };
}

// ============================================
// 257. Undo/Redo Actions
// ============================================
interface UndoRedoState<T> {
  current: T;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedo<T>(
  initialState: T,
  maxHistory: number = 50
): {
  state: T;
  setState: (value: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
} {
  const [history, setHistory] = useState<T[]>([initialState]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const state = history[currentIndex];

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setHistory((prev) => {
      const current = prev[currentIndex];
      const newValue = typeof value === 'function' ? (value as (prev: T) => T)(current) : value;

      // Remove any future history
      const newHistory = prev.slice(0, currentIndex + 1);
      newHistory.push(newValue);

      // Limit history size
      if (newHistory.length > maxHistory) {
        newHistory.shift();
        return newHistory;
      }

      return newHistory;
    });
    setCurrentIndex((prev) => Math.min(prev + 1, maxHistory - 1));
  }, [currentIndex, maxHistory]);

  const undo = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setCurrentIndex((prev) => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const clear = useCallback(() => {
    setHistory([initialState]);
    setCurrentIndex(0);
  }, [initialState]);

  return {
    state,
    setState,
    undo,
    redo,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < history.length - 1,
    clear,
  };
}

// ============================================
// 258. Responsive Font Size
// ============================================
export function useResponsiveFontSize(
  baseSizePx: number,
  minSizePx: number,
  maxSizePx: number
): string {
  const [fontSize, setFontSize] = useState(baseSizePx);

  useEffect(() => {
    const calculateSize = () => {
      const vw = window.innerWidth / 100;
      const calculated = baseSizePx + vw * 0.5;
      setFontSize(Math.max(minSizePx, Math.min(maxSizePx, calculated)));
    };

    calculateSize();
    window.addEventListener('resize', calculateSize);
    return () => window.removeEventListener('resize', calculateSize);
  }, [baseSizePx, minSizePx, maxSizePx]);

  return `${fontSize}px`;
}

// ============================================
// 259. Error Boundary Helper
// ============================================
interface ErrorInfo {
  componentStack: string;
}

interface ErrorState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export function useErrorBoundary() {
  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null,
    errorInfo: null,
  });

  const resetError = useCallback(() => {
    setErrorState({ hasError: false, error: null, errorInfo: null });
  }, []);

  const captureError = useCallback((error: Error, errorInfo?: ErrorInfo) => {
    setErrorState({
      hasError: true,
      error,
      errorInfo: errorInfo || null,
    });
  }, []);

  return { ...errorState, resetError, captureError };
}

// ============================================
// 260. Accessibility Audit Helper
// ============================================
interface A11yIssue {
  type: 'error' | 'warning';
  element: string;
  message: string;
  wcagGuideline?: string;
}

export function useA11yAudit(containerRef: React.RefObject<HTMLElement>) {
  const [issues, setIssues] = useState<A11yIssue[]>([]);

  const runAudit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const foundIssues: A11yIssue[] = [];

    // Check for images without alt text
    container.querySelectorAll('img:not([alt])').forEach((img) => {
      foundIssues.push({
        type: 'error',
        element: 'img',
        message: 'Image missing alt attribute',
        wcagGuideline: 'WCAG 1.1.1',
      });
    });

    // Check for buttons without accessible name
    container.querySelectorAll('button').forEach((button) => {
      if (!button.textContent?.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby')) {
        foundIssues.push({
          type: 'error',
          element: 'button',
          message: 'Button missing accessible name',
          wcagGuideline: 'WCAG 4.1.2',
        });
      }
    });

    // Check for form inputs without labels
    container.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach((input) => {
      const id = input.getAttribute('id');
      const hasLabel = id && container.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');

      if (!hasLabel && !hasAriaLabel) {
        foundIssues.push({
          type: 'error',
          element: input.tagName.toLowerCase(),
          message: 'Form control missing label',
          wcagGuideline: 'WCAG 1.3.1',
        });
      }
    });

    // Check for insufficient color contrast (basic check)
    container.querySelectorAll('*').forEach((el) => {
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize);
      if (fontSize < 14 && style.fontWeight === '400') {
        // Small text needs higher contrast
        foundIssues.push({
          type: 'warning',
          element: el.tagName.toLowerCase(),
          message: 'Small text may have insufficient contrast',
          wcagGuideline: 'WCAG 1.4.3',
        });
      }
    });

    // Check for missing heading hierarchy
    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;
    headings.forEach((heading) => {
      const level = parseInt(heading.tagName[1]);
      if (level > lastLevel + 1) {
        foundIssues.push({
          type: 'warning',
          element: heading.tagName.toLowerCase(),
          message: `Heading level skipped from h${lastLevel} to h${level}`,
          wcagGuideline: 'WCAG 1.3.1',
        });
      }
      lastLevel = level;
    });

    setIssues(foundIssues);
    return foundIssues;
  }, [containerRef]);

  return { issues, runAudit };
}

// Export types
export type {
  SkipLink,
  AriaLiveStatus,
  LiveRegion,
  TouchTargetValidation,
  TextSpacingOptions,
  KeyboardNavigation,
  FieldValidation,
  UndoRedoState,
  ErrorInfo,
  ErrorState,
  A11yIssue,
};

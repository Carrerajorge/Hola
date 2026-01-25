/**
 * Hooks Index
 * Central export for all custom React hooks
 */

// Core utility hooks
export { useCleanupInterval, useSafeInterval, useCleanupTimeout, useCleanupAnimationFrame, usePolling } from './useCleanupInterval';
export { useAbortController, useAbortableFetch, isAbortError, withAbortSignal } from './useAbortController';
export { useDebounce, useDebouncedCallback, useThrottle, useThrottledCallback, useDebouncedValue } from './useDebounce';

// State management hooks
export { useLocalStorage, useSessionStorage, useStorageObject, usePersistedToggle } from './useLocalStorage';
export { useOptimisticUpdate } from './useOptimisticUpdate';

// Async operation hooks
export {
  useAsync,
  useAsyncWithRetry,
  useAsyncPolling,
  useAsyncQueue,
  type AsyncStatus,
  type AsyncState,
  type UseAsyncReturn,
} from './useAsync';

// UI/UX hooks
export { useFocusTrap } from './useFocusTrap';
export { useClickOutside, useClickOutsideMultiple, useClickOutsideOrEscape } from './useClickOutside';
export {
  useKeyboardNavigation,
  useTypeaheadNavigation,
  useRovingTabIndex,
  useKeyboardShortcuts,
} from './useKeyboardNavigation';

// Media and responsive hooks
export {
  useMediaQuery,
  useBreakpoint,
  useCurrentBreakpoint,
  useIsMobile,
  useIsTablet,
  useIsDesktop,
  usePrefersReducedMotion,
  usePrefersDarkMode,
  useSupportsHover,
  useHasPointer,
  useResponsiveValue,
  useWindowSize,
} from './useMediaQuery';

// Image loading hooks
export { useLazyImage, useImagePreloader, useProgressiveImage } from './useLazyImage';

// Form validation hooks
export {
  useFormValidation,
  useLoginFormValidation,
  useRegistrationFormValidation,
  useProfileFormValidation,
  type FieldValidator,
  type FormField,
  type UseFormValidationReturn,
} from './useFormValidation';

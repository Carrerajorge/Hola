/**
 * Frontend Enhancements Index (201-300)
 * Export all frontend enhancement hooks and utilities
 */

// ============================================
// UI Components (201-220)
// ============================================
export {
  // Toast System
  ToastManager,
  toastManager,
  useToasts,

  // Modal System
  ModalManager,
  modalManager,
  useModals,

  // Confirm Dialog
  ConfirmManager,
  confirmManager,
  useConfirm,

  // Loading State
  LoadingManager,
  loadingManager,
  useLoading,

  // Keyboard Shortcuts
  KeyboardShortcutManager,
  keyboardManager,
  useKeyboardShortcut,

  // Clipboard
  useClipboard,

  // Form Helpers
  useForm,

  // Infinite Scroll
  useInfiniteScroll
} from './ui-components';

export type {
  Toast,
  ToastType,
  Modal,
  ConfirmOptions,
  KeyboardShortcut,
  FormConfig,
  FormState
} from './ui-components';

// ============================================
// State & Performance (221-240)
// ============================================
export {
  // Store Factory
  createStore,
  useStore,

  // Immer-like Updates
  produce,
  useImmer,

  // Atomic State
  atom,
  useAtom,

  // Selectors
  createSelector,

  // Async State
  useAsyncState,

  // Query Cache
  queryCache,
  useQuery,
  useMutation,
  useOptimisticUpdate,

  // Virtual List
  useVirtualList,

  // Debounced State
  useDebouncedState,
  useThrottledCallback,

  // Web Worker
  useWebWorker,

  // Animation
  useAnimationFrame,

  // Observers
  useIntersectionObserver,
  useResizeObserver,

  // Safe State
  useSafeState,
  usePrevious,
  useStateHistory,

  // Performance Monitor
  usePerformanceMonitor
} from './state-performance';

export type {
  AsyncState,
  QueryCacheEntry,
  UseQueryOptions,
  UseMutationOptions,
  VirtualListOptions,
  UseIntersectionObserverOptions,
  Size,
  PerformanceMetrics
} from './state-performance';

// ============================================
// UX & Accessibility (241-260)
// ============================================
export {
  // Focus Management
  useFocusTrap,
  useFocusVisible,
  useRovingTabIndex,

  // Screen Reader
  announcer,
  useAnnounce,
  ariaLiveManager,
  useAriaLive,

  // Skip Links
  useSkipLinks,

  // Preferences
  useReducedMotion,
  useHighContrast,
  useColorBlindMode,
  colorBlindSafePalette,

  // Touch Targets
  useTouchTargetValidator,

  // Text Spacing
  useTextSpacing,

  // Navigation
  useKeyboardNavigation,

  // Validation
  useFieldValidationAnnounce,
  useLoadingAnnounce,

  // Auto Dismiss
  useAutoDismiss,

  // Scroll
  useScrollRestoration,

  // Undo/Redo
  useUndoRedo,

  // Responsive
  useResponsiveFontSize,

  // Error Boundary
  useErrorBoundary,

  // A11y Audit
  useA11yAudit
} from './ux-accessibility';

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
  A11yIssue
} from './ux-accessibility';

// ============================================
// PWA & Offline (261-280)
// ============================================
export {
  // Service Worker
  useServiceWorker,

  // Online Status
  useOnlineStatus,

  // IndexedDB
  createIndexedDBStore,

  // Offline Queue
  offlineQueue,
  useOfflineQueue,

  // Cache Storage
  cacheResponse,
  getCachedResponse,

  // Background Sync
  useBackgroundSync,

  // Push Notifications
  usePushNotifications,

  // Install Prompt
  useInstallPrompt,

  // Network Info
  useNetworkInfo,

  // Persistent Storage
  usePersistentStorage,

  // Share API
  useShare,

  // Clipboard API
  useClipboardAPI,

  // Wake Lock
  useWakeLock,

  // File System
  useFileSystemAccess,

  // Storage
  useLocalStorageWithExpiry,
  useSessionStorage,

  // Broadcast Channel
  useBroadcastChannel,

  // Media Session
  useMediaSession,

  // Periodic Sync
  usePeriodicSync,

  // Content Visibility
  useContentVisibility
} from './pwa-offline';

export type {
  ServiceWorkerState,
  IDBStore,
  QueuedRequest,
  CacheOptions,
  PushNotificationState,
  InstallPromptState,
  NetworkInfo,
  StorageItem
} from './pwa-offline';

// ============================================
// Themes & i18n (281-300)
// ============================================
export {
  // Themes
  themes,
  createThemeProvider,
  useTheme,
  generateCSSVariables,
  useSystemTheme,
  useScheduledTheme,
  useThemeTransition,
  useColorModePersistence,

  // i18n Core
  i18n,
  useTranslation,

  // Formatters
  useNumberFormat,
  useDateFormat,
  usePluralization,
  useListFormat,
  useDisplayNames,

  // RTL
  useRTL,
  useDirectionalStyles,

  // Language Detection
  detectLanguage,

  // Translation Loading
  useTranslationLoader,

  // Fonts
  useFontLoader,

  // Locale Provider
  useLocale,
  createLocaleProvider
} from './themes-i18n';

export type {
  Theme,
  ThemeContextValue,
  ThemeSchedule,
  TranslationKey,
  TranslationValues,
  Translations,
  NumberFormatOptions,
  DateFormatOptions,
  PluralRules,
  LanguageDetectorOptions,
  TranslationLoader,
  FontConfig,
  LocaleContextValue
} from './themes-i18n';

// ============================================
// Initialization Helper
// ============================================
export function initializeEnhancements(): void {
  console.log('[Enhancements] Frontend enhancements (201-300) loaded');

  // Initialize keyboard shortcuts manager
  if (typeof window !== 'undefined') {
    // Auto-detect system theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');

    // Set language based on detection
    const detectedLanguage = detectLanguage({
      supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh']
    });
    i18n.setLocale(detectedLanguage);
    document.documentElement.lang = detectedLanguage;
  }
}

// Auto-initialize in browser
if (typeof window !== 'undefined') {
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEnhancements);
  } else {
    initializeEnhancements();
  }
}

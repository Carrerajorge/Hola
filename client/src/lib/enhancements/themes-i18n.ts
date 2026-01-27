/**
 * Themes & Internationalization Enhancements (281-300)
 * Theme system and multilingual support
 */

import { useState, useCallback, useEffect, useContext, createContext, useMemo } from 'react';

// ============================================
// 281. Theme System Core
// ============================================
interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    error: string;
    warning: string;
    success: string;
    info: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
  typography: {
    fontFamily: string;
    fontSizes: {
      xs: string;
      sm: string;
      md: string;
      lg: string;
      xl: string;
      xxl: string;
    };
    fontWeights: {
      normal: number;
      medium: number;
      semibold: number;
      bold: number;
    };
    lineHeights: {
      tight: number;
      normal: number;
      relaxed: number;
    };
  };
  transitions: {
    fast: string;
    normal: string;
    slow: string;
  };
}

const lightTheme: Theme = {
  name: 'light',
  colors: {
    primary: '#6366f1',
    secondary: '#8b5cf6',
    accent: '#06b6d4',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    textSecondary: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#22c55e',
    info: '#3b82f6',
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },
  borderRadius: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '1rem',
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      xxl: '1.5rem',
    },
    fontWeights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeights: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },
  transitions: {
    fast: '150ms ease-in-out',
    normal: '300ms ease-in-out',
    slow: '500ms ease-in-out',
  },
};

const darkTheme: Theme = {
  ...lightTheme,
  name: 'dark',
  colors: {
    primary: '#818cf8',
    secondary: '#a78bfa',
    accent: '#22d3ee',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155',
    error: '#f87171',
    warning: '#fbbf24',
    success: '#4ade80',
    info: '#60a5fa',
  },
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px rgba(0, 0, 0, 0.4)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.5)',
  },
};

export const themes = { light: lightTheme, dark: darkTheme };

// ============================================
// 282. Theme Context & Provider
// ============================================
interface ThemeContextValue {
  theme: Theme;
  themeName: string;
  setTheme: (name: string) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function createThemeProvider() {
  const customThemes = new Map<string, Theme>();

  const registerTheme = (name: string, theme: Theme) => {
    customThemes.set(name, theme);
  };

  const getTheme = (name: string): Theme => {
    return customThemes.get(name) || themes[name as keyof typeof themes] || themes.light;
  };

  return { ThemeContext, registerTheme, getTheme };
}

// ============================================
// 283. CSS Variables Generator
// ============================================
export function generateCSSVariables(theme: Theme): string {
  const variables: string[] = [];

  // Colors
  Object.entries(theme.colors).forEach(([key, value]) => {
    variables.push(`--color-${key}: ${value};`);
  });

  // Spacing
  Object.entries(theme.spacing).forEach(([key, value]) => {
    variables.push(`--spacing-${key}: ${value};`);
  });

  // Border radius
  Object.entries(theme.borderRadius).forEach(([key, value]) => {
    variables.push(`--radius-${key}: ${value};`);
  });

  // Shadows
  Object.entries(theme.shadows).forEach(([key, value]) => {
    variables.push(`--shadow-${key}: ${value};`);
  });

  // Typography
  variables.push(`--font-family: ${theme.typography.fontFamily};`);
  Object.entries(theme.typography.fontSizes).forEach(([key, value]) => {
    variables.push(`--font-size-${key}: ${value};`);
  });
  Object.entries(theme.typography.fontWeights).forEach(([key, value]) => {
    variables.push(`--font-weight-${key}: ${value};`);
  });
  Object.entries(theme.typography.lineHeights).forEach(([key, value]) => {
    variables.push(`--line-height-${key}: ${value};`);
  });

  // Transitions
  Object.entries(theme.transitions).forEach(([key, value]) => {
    variables.push(`--transition-${key}: ${value};`);
  });

  return `:root {\n  ${variables.join('\n  ')}\n}`;
}

// ============================================
// 284. System Theme Detection
// ============================================
export function useSystemTheme(): 'light' | 'dark' {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return systemTheme;
}

// ============================================
// 285. Theme Scheduler (Time-based)
// ============================================
interface ThemeSchedule {
  lightStart: number; // Hour (0-23)
  darkStart: number; // Hour (0-23)
}

export function useScheduledTheme(schedule: ThemeSchedule): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const hour = new Date().getHours();
    return hour >= schedule.lightStart && hour < schedule.darkStart ? 'light' : 'dark';
  });

  useEffect(() => {
    const checkTheme = () => {
      const hour = new Date().getHours();
      const newTheme = hour >= schedule.lightStart && hour < schedule.darkStart ? 'light' : 'dark';
      setTheme(newTheme);
    };

    const interval = setInterval(checkTheme, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [schedule.lightStart, schedule.darkStart]);

  return theme;
}

// ============================================
// 286. Theme Animation
// ============================================
export function useThemeTransition(duration: number = 300) {
  const [isTransitioning, setIsTransitioning] = useState(false);

  const startTransition = useCallback(() => {
    setIsTransitioning(true);
    document.documentElement.classList.add('theme-transitioning');

    setTimeout(() => {
      setIsTransitioning(false);
      document.documentElement.classList.remove('theme-transitioning');
    }, duration);
  }, [duration]);

  const transitionCSS = `
    .theme-transitioning,
    .theme-transitioning *,
    .theme-transitioning *::before,
    .theme-transitioning *::after {
      transition: background-color ${duration}ms ease-in-out,
                  color ${duration}ms ease-in-out,
                  border-color ${duration}ms ease-in-out,
                  box-shadow ${duration}ms ease-in-out !important;
    }
  `;

  return { isTransitioning, startTransition, transitionCSS };
}

// ============================================
// 287. Color Mode Persistence
// ============================================
export function useColorModePersistence(key: string = 'color-mode') {
  const [mode, setMode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
  });

  const saveMode = useCallback((newMode: string) => {
    localStorage.setItem(key, newMode);
    setMode(newMode);
  }, [key]);

  const clearMode = useCallback(() => {
    localStorage.removeItem(key);
    setMode(null);
  }, [key]);

  return { mode, saveMode, clearMode };
}

// ============================================
// 288. Internationalization Core
// ============================================
type TranslationKey = string;
type TranslationValues = Record<string, string | number>;
type Translations = Record<string, Record<string, string>>;

class I18nManager {
  private locale: string = 'en';
  private translations: Translations = {};
  private fallbackLocale: string = 'en';
  private listeners: Set<() => void> = new Set();

  setLocale(locale: string): void {
    this.locale = locale;
    this.notify();
  }

  getLocale(): string {
    return this.locale;
  }

  setFallbackLocale(locale: string): void {
    this.fallbackLocale = locale;
  }

  addTranslations(locale: string, translations: Record<string, string>): void {
    this.translations[locale] = { ...this.translations[locale], ...translations };
  }

  t(key: TranslationKey, values?: TranslationValues): string {
    const translation =
      this.translations[this.locale]?.[key] ||
      this.translations[this.fallbackLocale]?.[key] ||
      key;

    if (!values) return translation;

    return Object.entries(values).reduce(
      (result, [k, v]) => result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
      translation
    );
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
  }
}

export const i18n = new I18nManager();

// ============================================
// 289. useTranslation Hook
// ============================================
export function useTranslation(namespace?: string) {
  const [, forceUpdate] = useState({});

  useEffect(() => {
    return i18n.subscribe(() => forceUpdate({}));
  }, []);

  const t = useCallback(
    (key: string, values?: TranslationValues) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      return i18n.t(fullKey, values);
    },
    [namespace]
  );

  return { t, locale: i18n.getLocale(), setLocale: i18n.setLocale.bind(i18n) };
}

// ============================================
// 290. Number Formatting
// ============================================
interface NumberFormatOptions {
  style?: 'decimal' | 'currency' | 'percent';
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
}

export function useNumberFormat(locale?: string) {
  const currentLocale = locale || i18n.getLocale();

  const formatNumber = useCallback(
    (value: number, options?: NumberFormatOptions) => {
      return new Intl.NumberFormat(currentLocale, options).format(value);
    },
    [currentLocale]
  );

  const formatCurrency = useCallback(
    (value: number, currency: string = 'USD') => {
      return new Intl.NumberFormat(currentLocale, {
        style: 'currency',
        currency,
      }).format(value);
    },
    [currentLocale]
  );

  const formatPercent = useCallback(
    (value: number) => {
      return new Intl.NumberFormat(currentLocale, {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);
    },
    [currentLocale]
  );

  const formatCompact = useCallback(
    (value: number) => {
      return new Intl.NumberFormat(currentLocale, {
        notation: 'compact',
        compactDisplay: 'short',
      }).format(value);
    },
    [currentLocale]
  );

  return { formatNumber, formatCurrency, formatPercent, formatCompact };
}

// ============================================
// 291. Date Formatting
// ============================================
interface DateFormatOptions {
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

export function useDateFormat(locale?: string) {
  const currentLocale = locale || i18n.getLocale();

  const formatDate = useCallback(
    (date: Date | number | string, options?: DateFormatOptions) => {
      const d = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(currentLocale, options).format(d);
    },
    [currentLocale]
  );

  const formatRelative = useCallback(
    (date: Date | number | string) => {
      const d = date instanceof Date ? date : new Date(date);
      const now = new Date();
      const diffMs = d.getTime() - now.getTime();
      const diffSecs = Math.round(diffMs / 1000);
      const diffMins = Math.round(diffSecs / 60);
      const diffHours = Math.round(diffMins / 60);
      const diffDays = Math.round(diffHours / 24);
      const diffWeeks = Math.round(diffDays / 7);
      const diffMonths = Math.round(diffDays / 30);
      const diffYears = Math.round(diffDays / 365);

      const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' });

      if (Math.abs(diffSecs) < 60) return rtf.format(diffSecs, 'second');
      if (Math.abs(diffMins) < 60) return rtf.format(diffMins, 'minute');
      if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
      if (Math.abs(diffDays) < 7) return rtf.format(diffDays, 'day');
      if (Math.abs(diffWeeks) < 4) return rtf.format(diffWeeks, 'week');
      if (Math.abs(diffMonths) < 12) return rtf.format(diffMonths, 'month');
      return rtf.format(diffYears, 'year');
    },
    [currentLocale]
  );

  const formatTime = useCallback(
    (date: Date | number | string) => {
      const d = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(currentLocale, {
        hour: 'numeric',
        minute: 'numeric',
      }).format(d);
    },
    [currentLocale]
  );

  return { formatDate, formatRelative, formatTime };
}

// ============================================
// 292. Pluralization
// ============================================
type PluralRules = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export function usePluralization(locale?: string) {
  const currentLocale = locale || i18n.getLocale();

  const pluralize = useCallback(
    (count: number, rules: PluralRules) => {
      const pluralRules = new Intl.PluralRules(currentLocale);
      const category = pluralRules.select(count);
      return rules[category as keyof PluralRules] || rules.other;
    },
    [currentLocale]
  );

  return { pluralize };
}

// ============================================
// 293. List Formatting
// ============================================
export function useListFormat(locale?: string) {
  const currentLocale = locale || i18n.getLocale();

  const formatList = useCallback(
    (items: string[], type: 'conjunction' | 'disjunction' | 'unit' = 'conjunction') => {
      return new Intl.ListFormat(currentLocale, { style: 'long', type }).format(items);
    },
    [currentLocale]
  );

  return { formatList };
}

// ============================================
// 294. Display Names (Languages, Regions)
// ============================================
export function useDisplayNames(locale?: string) {
  const currentLocale = locale || i18n.getLocale();

  const getLanguageName = useCallback(
    (code: string) => {
      return new Intl.DisplayNames(currentLocale, { type: 'language' }).of(code);
    },
    [currentLocale]
  );

  const getRegionName = useCallback(
    (code: string) => {
      return new Intl.DisplayNames(currentLocale, { type: 'region' }).of(code);
    },
    [currentLocale]
  );

  const getCurrencyName = useCallback(
    (code: string) => {
      return new Intl.DisplayNames(currentLocale, { type: 'currency' }).of(code);
    },
    [currentLocale]
  );

  return { getLanguageName, getRegionName, getCurrencyName };
}

// ============================================
// 295. RTL Support
// ============================================
const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'dv'];

export function useRTL(locale?: string) {
  const currentLocale = locale || i18n.getLocale();
  const isRTL = rtlLanguages.some((lang) => currentLocale.startsWith(lang));

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = currentLocale;
  }, [isRTL, currentLocale]);

  return {
    isRTL,
    dir: isRTL ? 'rtl' : 'ltr',
    start: isRTL ? 'right' : 'left',
    end: isRTL ? 'left' : 'right',
  };
}

// ============================================
// 296. Language Detector
// ============================================
interface LanguageDetectorOptions {
  fromNavigator?: boolean;
  fromUrl?: boolean;
  fromStorage?: boolean;
  storageKey?: string;
  supportedLanguages?: string[];
  fallback?: string;
}

export function detectLanguage(options: LanguageDetectorOptions = {}): string {
  const {
    fromNavigator = true,
    fromUrl = true,
    fromStorage = true,
    storageKey = 'language',
    supportedLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
    fallback = 'en',
  } = options;

  const isSupported = (lang: string) =>
    supportedLanguages.some((supported) => lang.startsWith(supported));

  // Check URL parameter
  if (fromUrl && typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang && isSupported(urlLang)) return urlLang;
  }

  // Check localStorage
  if (fromStorage && typeof window !== 'undefined') {
    const storedLang = localStorage.getItem(storageKey);
    if (storedLang && isSupported(storedLang)) return storedLang;
  }

  // Check navigator
  if (fromNavigator && typeof navigator !== 'undefined') {
    const browserLang = navigator.language;
    if (isSupported(browserLang)) return browserLang.split('-')[0];

    for (const lang of navigator.languages || []) {
      if (isSupported(lang)) return lang.split('-')[0];
    }
  }

  return fallback;
}

// ============================================
// 297. Translation Loading
// ============================================
type TranslationLoader = (locale: string) => Promise<Record<string, string>>;

export function useTranslationLoader(loader: TranslationLoader) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadedLocales = useRef<Set<string>>(new Set());

  const loadTranslations = useCallback(
    async (locale: string) => {
      if (loadedLocales.current.has(locale)) return;

      setIsLoading(true);
      setError(null);

      try {
        const translations = await loader(locale);
        i18n.addTranslations(locale, translations);
        loadedLocales.current.add(locale);
      } catch (err) {
        setError(err as Error);
      } finally {
        setIsLoading(false);
      }
    },
    [loader]
  );

  return { loadTranslations, isLoading, error };
}

// ============================================
// 298. Text Direction Aware Styles
// ============================================
export function useDirectionalStyles() {
  const { isRTL, start, end } = useRTL();

  const directionalStyles = useMemo(
    () => ({
      paddingStart: (value: string) => ({ [`padding${isRTL ? 'Right' : 'Left'}`]: value }),
      paddingEnd: (value: string) => ({ [`padding${isRTL ? 'Left' : 'Right'}`]: value }),
      marginStart: (value: string) => ({ [`margin${isRTL ? 'Right' : 'Left'}`]: value }),
      marginEnd: (value: string) => ({ [`margin${isRTL ? 'Left' : 'Right'}`]: value }),
      borderStart: (value: string) => ({ [`border${isRTL ? 'Right' : 'Left'}`]: value }),
      borderEnd: (value: string) => ({ [`border${isRTL ? 'Left' : 'Right'}`]: value }),
      insetStart: (value: string) => ({ [start]: value }),
      insetEnd: (value: string) => ({ [end]: value }),
      textAlign: () => ({ textAlign: start as 'left' | 'right' }),
    }),
    [isRTL, start, end]
  );

  return { ...directionalStyles, isRTL };
}

// ============================================
// 299. Font Loading for Different Scripts
// ============================================
interface FontConfig {
  family: string;
  weights: number[];
  subsets: string[];
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

export function useFontLoader() {
  const [loadedFonts, setLoadedFonts] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const loadFont = useCallback(async (config: FontConfig): Promise<boolean> => {
    const fontKey = `${config.family}-${config.weights.join('-')}`;
    if (loadedFonts.has(fontKey)) return true;

    setIsLoading(true);

    try {
      for (const weight of config.weights) {
        const font = new FontFace(
          config.family,
          `url(https://fonts.gstatic.com/s/${config.family.toLowerCase().replace(/\s/g, '')}/${weight}.woff2)`,
          {
            weight: String(weight),
            display: config.display || 'swap',
          }
        );

        await font.load();
        document.fonts.add(font);
      }

      setLoadedFonts((prev) => new Set([...prev, fontKey]));
      return true;
    } catch (error) {
      console.error(`Failed to load font ${config.family}:`, error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [loadedFonts]);

  const preloadFontsForLocale = useCallback(
    async (locale: string) => {
      const fontConfigs: Record<string, FontConfig> = {
        ar: { family: 'Noto Sans Arabic', weights: [400, 700], subsets: ['arabic'] },
        he: { family: 'Noto Sans Hebrew', weights: [400, 700], subsets: ['hebrew'] },
        ja: { family: 'Noto Sans JP', weights: [400, 700], subsets: ['japanese'] },
        ko: { family: 'Noto Sans KR', weights: [400, 700], subsets: ['korean'] },
        zh: { family: 'Noto Sans SC', weights: [400, 700], subsets: ['chinese-simplified'] },
        th: { family: 'Noto Sans Thai', weights: [400, 700], subsets: ['thai'] },
      };

      const config = fontConfigs[locale.split('-')[0]];
      if (config) {
        await loadFont(config);
      }
    },
    [loadFont]
  );

  return { loadFont, preloadFontsForLocale, loadedFonts, isLoading };
}

// ============================================
// 300. Locale Context Provider
// ============================================
interface LocaleContextValue {
  locale: string;
  setLocale: (locale: string) => void;
  supportedLocales: string[];
  t: (key: string, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: NumberFormatOptions) => string;
  formatDate: (date: Date | number | string, options?: DateFormatOptions) => string;
  formatRelative: (date: Date | number | string) => string;
  isRTL: boolean;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

export function createLocaleProvider(supportedLocales: string[] = ['en', 'es', 'fr', 'de']) {
  return function LocaleProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocale] = useState(() => detectLanguage({ supportedLanguages: supportedLocales }));
    const { t } = useTranslation();
    const { formatNumber } = useNumberFormat(locale);
    const { formatDate, formatRelative } = useDateFormat(locale);
    const { isRTL } = useRTL(locale);

    const handleSetLocale = useCallback((newLocale: string) => {
      if (supportedLocales.includes(newLocale)) {
        setLocale(newLocale);
        i18n.setLocale(newLocale);
        localStorage.setItem('language', newLocale);
      }
    }, []);

    const value = useMemo(
      () => ({
        locale,
        setLocale: handleSetLocale,
        supportedLocales,
        t,
        formatNumber,
        formatDate,
        formatRelative,
        isRTL,
      }),
      [locale, handleSetLocale, t, formatNumber, formatDate, formatRelative, isRTL]
    );

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
  };
}

// Export types
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
  LocaleContextValue,
};

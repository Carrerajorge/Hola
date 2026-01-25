import { useState, useEffect, useCallback, useRef } from 'react';
import { safeStorage } from '@/lib/storage';

/**
 * Hook for persisting state in localStorage with automatic serialization
 * Falls back to in-memory storage when localStorage is unavailable
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Track if we're mounted to avoid state updates after unmount
  const isMounted = useRef(true);

  // Initialize state from storage or use initial value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      return safeStorage.get<T>(key, initialValue);
    } catch {
      return initialValue;
    }
  });

  // Update localStorage when state changes
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const valueToStore = value instanceof Function ? value(prev) : value;

      // Save to storage asynchronously
      safeStorage.set(key, valueToStore);

      return valueToStore;
    });
  }, [key]);

  // Remove from storage
  const removeValue = useCallback(() => {
    safeStorage.remove(key);
    setStoredValue(initialValue);
  }, [key, initialValue]);

  // Sync with other tabs/windows
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && isMounted.current) {
        try {
          const newValue = event.newValue
            ? JSON.parse(event.newValue) as T
            : initialValue;
          setStoredValue(newValue);
        } catch {
          setStoredValue(initialValue);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      isMounted.current = false;
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

/**
 * Hook for persisting state in sessionStorage
 * Data is cleared when the browser session ends
 */
export function useSessionStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') return initialValue;
      const item = sessionStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue(prev => {
      const valueToStore = value instanceof Function ? value(prev) : value;

      try {
        sessionStorage.setItem(key, JSON.stringify(valueToStore));
      } catch (error) {
        console.warn(`[SessionStorage] Error setting "${key}":`, error);
      }

      return valueToStore;
    });
  }, [key]);

  const removeValue = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

/**
 * Hook for managing multiple storage keys with a single interface
 * Useful for managing related settings
 */
export function useStorageObject<T extends Record<string, unknown>>(
  prefix: string,
  initialValues: T
): {
  values: T;
  setValue: <K extends keyof T>(key: K, value: T[K]) => void;
  setValues: (values: Partial<T>) => void;
  resetToDefaults: () => void;
} {
  const [values, setValuesState] = useState<T>(() => {
    const result = { ...initialValues };

    for (const key of Object.keys(initialValues)) {
      const storageKey = `${prefix}:${key}`;
      const stored = safeStorage.get(storageKey, initialValues[key as keyof T]);
      (result as Record<string, unknown>)[key] = stored;
    }

    return result;
  });

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    const storageKey = `${prefix}:${String(key)}`;
    safeStorage.set(storageKey, value);

    setValuesState(prev => ({
      ...prev,
      [key]: value,
    }));
  }, [prefix]);

  const setValues = useCallback((newValues: Partial<T>) => {
    for (const [key, value] of Object.entries(newValues)) {
      const storageKey = `${prefix}:${key}`;
      safeStorage.set(storageKey, value);
    }

    setValuesState(prev => ({
      ...prev,
      ...newValues,
    }));
  }, [prefix]);

  const resetToDefaults = useCallback(() => {
    for (const key of Object.keys(initialValues)) {
      const storageKey = `${prefix}:${key}`;
      safeStorage.remove(storageKey);
    }

    setValuesState(initialValues);
  }, [prefix, initialValues]);

  return { values, setValue, setValues, resetToDefaults };
}

/**
 * Hook for persisting a boolean toggle state
 * Common pattern for feature flags and settings
 */
export function usePersistedToggle(
  key: string,
  defaultValue: boolean = false
): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useLocalStorage(key, defaultValue);

  const toggle = useCallback(() => {
    setValue(prev => !prev);
  }, [setValue]);

  const setExplicit = useCallback((newValue: boolean) => {
    setValue(newValue);
  }, [setValue]);

  return [value, toggle, setExplicit];
}

export default useLocalStorage;

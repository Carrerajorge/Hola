/**
 * Safe LocalStorage Utility
 * Provides error-safe access to localStorage with fallbacks
 */

// In-memory fallback when localStorage is unavailable
const memoryStorage = new Map<string, string>();

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safe localStorage getter with fallback
 * @param key - Storage key
 * @param defaultValue - Default value if key doesn't exist or on error
 */
export function getStorageItem<T>(key: string, defaultValue: T): T {
  try {
    if (!isLocalStorageAvailable()) {
      const memValue = memoryStorage.get(key);
      return memValue ? JSON.parse(memValue) : defaultValue;
    }

    const item = localStorage.getItem(key);
    if (item === null) {
      return defaultValue;
    }

    return JSON.parse(item) as T;
  } catch (error) {
    console.warn(`[Storage] Error reading key "${key}":`, error);
    return defaultValue;
  }
}

/**
 * Safe localStorage setter with error handling
 * @param key - Storage key
 * @param value - Value to store
 * @returns true if successful, false otherwise
 */
export function setStorageItem<T>(key: string, value: T): boolean {
  try {
    const serialized = JSON.stringify(value);

    if (!isLocalStorageAvailable()) {
      memoryStorage.set(key, serialized);
      return true;
    }

    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    // Handle QuotaExceededError
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      console.warn(`[Storage] Storage quota exceeded for key "${key}". Consider clearing old data.`);

      // Try to store in memory as fallback
      try {
        memoryStorage.set(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }

    console.warn(`[Storage] Error writing key "${key}":`, error);
    return false;
  }
}

/**
 * Safe localStorage removal
 * @param key - Storage key to remove
 */
export function removeStorageItem(key: string): boolean {
  try {
    memoryStorage.delete(key);

    if (isLocalStorageAvailable()) {
      localStorage.removeItem(key);
    }

    return true;
  } catch (error) {
    console.warn(`[Storage] Error removing key "${key}":`, error);
    return false;
  }
}

/**
 * Get all keys in storage matching a prefix
 * @param prefix - Key prefix to match
 */
export function getStorageKeys(prefix?: string): string[] {
  try {
    const keys: string[] = [];

    if (isLocalStorageAvailable()) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (!prefix || key.startsWith(prefix))) {
          keys.push(key);
        }
      }
    }

    // Also include memory storage keys
    for (const key of memoryStorage.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }

    return keys;
  } catch (error) {
    console.warn('[Storage] Error getting keys:', error);
    return [];
  }
}

/**
 * Clear all storage items (optionally matching a prefix)
 * @param prefix - Optional prefix to match
 */
export function clearStorage(prefix?: string): boolean {
  try {
    if (prefix) {
      const keys = getStorageKeys(prefix);
      keys.forEach(key => removeStorageItem(key));
    } else {
      memoryStorage.clear();
      if (isLocalStorageAvailable()) {
        localStorage.clear();
      }
    }
    return true;
  } catch (error) {
    console.warn('[Storage] Error clearing storage:', error);
    return false;
  }
}

/**
 * Get storage usage info
 */
export function getStorageUsage(): { used: number; available: boolean } {
  try {
    if (!isLocalStorageAvailable()) {
      return { used: 0, available: false };
    }

    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += key.length + value.length;
        }
      }
    }

    return {
      used: totalSize * 2, // UTF-16 uses 2 bytes per character
      available: true,
    };
  } catch (error) {
    return { used: 0, available: false };
  }
}

/**
 * Hook-friendly wrapper for storage with automatic JSON parsing
 */
export const safeStorage = {
  get: getStorageItem,
  set: setStorageItem,
  remove: removeStorageItem,
  keys: getStorageKeys,
  clear: clearStorage,
  usage: getStorageUsage,
  isAvailable: isLocalStorageAvailable,
};

export default safeStorage;

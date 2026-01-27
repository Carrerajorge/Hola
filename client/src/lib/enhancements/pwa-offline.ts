/**
 * PWA & Offline Enhancements (261-280)
 * Progressive Web App features and offline support
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ============================================
// 261. Service Worker Registration
// ============================================
interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

export function useServiceWorker(swUrl: string = '/sw.js') {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    isRegistered: false,
    isUpdateAvailable: false,
    registration: null,
  });

  useEffect(() => {
    if (!state.isSupported) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register(swUrl);

        setState((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
        }));

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setState((prev) => ({ ...prev, isUpdateAvailable: true }));
              }
            });
          }
        });
      } catch (error) {
        console.error('Service worker registration failed:', error);
      }
    };

    registerSW();
  }, [swUrl, state.isSupported]);

  const update = useCallback(async () => {
    if (state.registration) {
      await state.registration.update();
    }
  }, [state.registration]);

  const skipWaiting = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [state.registration]);

  return { ...state, update, skipWaiting };
}

// ============================================
// 262. Online/Offline Status
// ============================================
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline) {
        // Trigger sync when coming back online
        window.dispatchEvent(new CustomEvent('app:back-online'));
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [wasOffline]);

  return { isOnline, wasOffline };
}

// ============================================
// 263. IndexedDB Wrapper
// ============================================
interface IDBStore<T> {
  get: (key: string) => Promise<T | undefined>;
  set: (key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
  clear: () => Promise<void>;
  keys: () => Promise<string[]>;
  getAll: () => Promise<T[]>;
}

export function createIndexedDBStore<T>(
  dbName: string,
  storeName: string,
  version: number = 1
): IDBStore<T> {
  let db: IDBDatabase | null = null;

  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      if (db) {
        resolve(db);
        return;
      }

      const request = indexedDB.open(dbName, version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName);
        }
      };
    });
  };

  return {
    async get(key: string): Promise<T | undefined> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    },

    async set(key: string, value: T): Promise<void> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value, key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    },

    async delete(key: string): Promise<void> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    },

    async clear(): Promise<void> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    },

    async keys(): Promise<string[]> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAllKeys();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as string[]);
      });
    },

    async getAll(): Promise<T[]> {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    },
  };
}

// ============================================
// 264. Offline Queue Manager
// ============================================
interface QueuedRequest {
  id: string;
  url: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
  timestamp: number;
  retries: number;
}

class OfflineQueue {
  private store = createIndexedDBStore<QueuedRequest>('offline-queue', 'requests');
  private processing = false;
  private listeners: Set<(count: number) => void> = new Set();

  async add(request: Omit<QueuedRequest, 'id' | 'timestamp' | 'retries'>): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queuedRequest: QueuedRequest = {
      ...request,
      id,
      timestamp: Date.now(),
      retries: 0,
    };
    await this.store.set(id, queuedRequest);
    this.notifyListeners();
    return id;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id);
    this.notifyListeners();
  }

  async getAll(): Promise<QueuedRequest[]> {
    return this.store.getAll();
  }

  async process(): Promise<void> {
    if (this.processing || !navigator.onLine) return;

    this.processing = true;
    const requests = await this.getAll();

    for (const request of requests) {
      try {
        const response = await fetch(request.url, {
          method: request.method,
          body: request.body ? JSON.stringify(request.body) : undefined,
          headers: {
            'Content-Type': 'application/json',
            ...request.headers,
          },
        });

        if (response.ok) {
          await this.remove(request.id);
        } else if (request.retries < 3) {
          await this.store.set(request.id, { ...request, retries: request.retries + 1 });
        } else {
          await this.remove(request.id);
          console.error(`Request ${request.id} failed after max retries`);
        }
      } catch (error) {
        if (request.retries < 3) {
          await this.store.set(request.id, { ...request, retries: request.retries + 1 });
        }
      }
    }

    this.processing = false;
    this.notifyListeners();
  }

  subscribe(callback: (count: number) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private async notifyListeners(): Promise<void> {
    const requests = await this.getAll();
    this.listeners.forEach((cb) => cb(requests.length));
  }
}

export const offlineQueue = new OfflineQueue();

export function useOfflineQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const { isOnline } = useOnlineStatus();

  useEffect(() => {
    const loadCount = async () => {
      const requests = await offlineQueue.getAll();
      setPendingCount(requests.length);
    };
    loadCount();

    return offlineQueue.subscribe(setPendingCount);
  }, []);

  useEffect(() => {
    if (isOnline) {
      offlineQueue.process();
    }
  }, [isOnline]);

  return { pendingCount, queue: offlineQueue };
}

// ============================================
// 265. Cache Storage Manager
// ============================================
interface CacheOptions {
  cacheName: string;
  maxAge?: number; // milliseconds
  maxItems?: number;
}

export async function cacheResponse(
  url: string,
  response: Response,
  options: CacheOptions
): Promise<void> {
  const cache = await caches.open(options.cacheName);
  const headers = new Headers(response.headers);
  headers.set('x-cached-at', Date.now().toString());

  const cachedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(url, cachedResponse);

  if (options.maxItems) {
    const keys = await cache.keys();
    if (keys.length > options.maxItems) {
      const toDelete = keys.slice(0, keys.length - options.maxItems);
      await Promise.all(toDelete.map((key) => cache.delete(key)));
    }
  }
}

export async function getCachedResponse(
  url: string,
  options: CacheOptions
): Promise<Response | null> {
  const cache = await caches.open(options.cacheName);
  const response = await cache.match(url);

  if (!response) return null;

  if (options.maxAge) {
    const cachedAt = response.headers.get('x-cached-at');
    if (cachedAt && Date.now() - parseInt(cachedAt) > options.maxAge) {
      await cache.delete(url);
      return null;
    }
  }

  return response;
}

// ============================================
// 266. Background Sync Manager
// ============================================
export function useBackgroundSync(tag: string) {
  const [isSupported, setIsSupported] = useState(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setIsSupported('serviceWorker' in navigator && 'SyncManager' in window);
  }, []);

  const requestSync = useCallback(async () => {
    if (!isSupported) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register(tag);
      setIsPending(true);
      return true;
    } catch (error) {
      console.error('Background sync registration failed:', error);
      return false;
    }
  }, [isSupported, tag]);

  useEffect(() => {
    const handleSyncComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail?.tag === tag) {
        setIsPending(false);
      }
    };

    window.addEventListener('sync-complete', handleSyncComplete);
    return () => window.removeEventListener('sync-complete', handleSyncComplete);
  }, [tag]);

  return { isSupported, isPending, requestSync };
}

// ============================================
// 267. Push Notification Manager
// ============================================
interface PushNotificationState {
  isSupported: boolean;
  permission: NotificationPermission;
  subscription: PushSubscription | null;
}

export function usePushNotifications(vapidPublicKey: string) {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: typeof window !== 'undefined' && 'PushManager' in window,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    subscription: null,
  });

  useEffect(() => {
    if (!state.isSupported) return;

    const getSubscription = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setState((prev) => ({ ...prev, subscription }));
      } catch (error) {
        console.error('Failed to get push subscription:', error);
      }
    };

    getSubscription();
  }, [state.isSupported]);

  const requestPermission = useCallback(async () => {
    const permission = await Notification.requestPermission();
    setState((prev) => ({ ...prev, permission }));
    return permission;
  }, []);

  const subscribe = useCallback(async () => {
    if (state.permission !== 'granted') {
      const permission = await requestPermission();
      if (permission !== 'granted') return null;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      setState((prev) => ({ ...prev, subscription }));
      return subscription;
    } catch (error) {
      console.error('Failed to subscribe to push notifications:', error);
      return null;
    }
  }, [state.permission, vapidPublicKey, requestPermission]);

  const unsubscribe = useCallback(async () => {
    if (!state.subscription) return;

    try {
      await state.subscription.unsubscribe();
      setState((prev) => ({ ...prev, subscription: null }));
    } catch (error) {
      console.error('Failed to unsubscribe from push notifications:', error);
    }
  }, [state.subscription]);

  return { ...state, requestPermission, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ============================================
// 268. App Install Prompt
// ============================================
interface InstallPromptState {
  canInstall: boolean;
  isInstalled: boolean;
}

export function useInstallPrompt() {
  const [state, setState] = useState<InstallPromptState>({
    canInstall: false,
    isInstalled: false,
  });
  const deferredPromptRef = useRef<any>(null);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setState({ canInstall: false, isInstalled: true });
      return;
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
      setState((prev) => ({ ...prev, canInstall: true }));
    };

    const handleAppInstalled = () => {
      setState({ canInstall: false, isInstalled: true });
      deferredPromptRef.current = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPromptRef.current) return false;

    deferredPromptRef.current.prompt();
    const { outcome } = await deferredPromptRef.current.userChoice;
    deferredPromptRef.current = null;
    setState((prev) => ({ ...prev, canInstall: false }));

    return outcome === 'accepted';
  }, []);

  return { ...state, promptInstall };
}

// ============================================
// 269. Network Information API
// ============================================
interface NetworkInfo {
  effectiveType: '2g' | '3g' | '4g' | 'slow-2g' | 'unknown';
  downlink: number;
  rtt: number;
  saveData: boolean;
}

export function useNetworkInfo(): NetworkInfo {
  const [info, setInfo] = useState<NetworkInfo>({
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0,
    saveData: false,
  });

  useEffect(() => {
    const connection = (navigator as any).connection;
    if (!connection) return;

    const updateInfo = () => {
      setInfo({
        effectiveType: connection.effectiveType || 'unknown',
        downlink: connection.downlink || 0,
        rtt: connection.rtt || 0,
        saveData: connection.saveData || false,
      });
    };

    updateInfo();
    connection.addEventListener('change', updateInfo);
    return () => connection.removeEventListener('change', updateInfo);
  }, []);

  return info;
}

// ============================================
// 270. Persistent Storage Request
// ============================================
export function usePersistentStorage() {
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<{ quota: number; usage: number } | null>(null);

  useEffect(() => {
    const checkStorage = async () => {
      if (navigator.storage && navigator.storage.persisted) {
        const persisted = await navigator.storage.persisted();
        setIsPersisted(persisted);
      }

      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageEstimate({
          quota: estimate.quota || 0,
          usage: estimate.usage || 0,
        });
      }
    };

    checkStorage();
  }, []);

  const requestPersistence = useCallback(async () => {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      setIsPersisted(persisted);
      return persisted;
    }
    return false;
  }, []);

  return { isPersisted, storageEstimate, requestPersistence };
}

// ============================================
// 271. Share API Integration
// ============================================
export function useShare() {
  const [canShare, setCanShare] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && 'share' in navigator);
    setCanShareFiles(typeof navigator !== 'undefined' && 'canShare' in navigator);
  }, []);

  const share = useCallback(async (data: ShareData) => {
    if (!canShare) return false;

    try {
      await navigator.share(data);
      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Share failed:', error);
      }
      return false;
    }
  }, [canShare]);

  const shareFiles = useCallback(async (files: File[], data?: Partial<ShareData>) => {
    if (!canShareFiles) return false;

    const shareData = { files, ...data };
    if (!navigator.canShare(shareData)) return false;

    try {
      await navigator.share(shareData);
      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Share files failed:', error);
      }
      return false;
    }
  }, [canShareFiles]);

  return { canShare, canShareFiles, share, shareFiles };
}

// ============================================
// 272. Clipboard API with Fallback
// ============================================
export function useClipboardAPI() {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(typeof navigator !== 'undefined' && 'clipboard' in navigator);
  }, []);

  const readText = useCallback(async (): Promise<string | null> => {
    if (!isSupported) return null;

    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return null;
    }
  }, [isSupported]);

  const writeText = useCallback(async (text: string): Promise<boolean> => {
    if (isSupported) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        // Fall through to fallback
      }
    }

    // Fallback for older browsers
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch (error) {
      console.error('Clipboard write failed:', error);
      return false;
    }
  }, [isSupported]);

  const readImage = useCallback(async (): Promise<Blob | null> => {
    if (!isSupported) return null;

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png')) {
          return await item.getType('image/png');
        }
      }
      return null;
    } catch (error) {
      console.error('Failed to read image from clipboard:', error);
      return null;
    }
  }, [isSupported]);

  return { isSupported, readText, writeText, readImage };
}

// ============================================
// 273. Wake Lock API
// ============================================
export function useWakeLock() {
  const [isSupported, setIsSupported] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    setIsSupported('wakeLock' in navigator);
  }, []);

  const requestLock = useCallback(async () => {
    if (!isSupported) return false;

    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      setIsLocked(true);

      wakeLockRef.current.addEventListener('release', () => {
        setIsLocked(false);
      });

      return true;
    } catch (error) {
      console.error('Wake lock request failed:', error);
      return false;
    }
  }, [isSupported]);

  const releaseLock = useCallback(async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsLocked(false);
    }
  }, []);

  // Re-acquire lock when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && wakeLockRef.current === null && isLocked) {
        await requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isLocked, requestLock]);

  return { isSupported, isLocked, requestLock, releaseLock };
}

// ============================================
// 274. File System Access API
// ============================================
export function useFileSystemAccess() {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported('showOpenFilePicker' in window);
  }, []);

  const openFile = useCallback(async (options?: OpenFilePickerOptions): Promise<File | null> => {
    if (!isSupported) return null;

    try {
      const [handle] = await (window as any).showOpenFilePicker(options);
      return await handle.getFile();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to open file:', error);
      }
      return null;
    }
  }, [isSupported]);

  const saveFile = useCallback(async (
    content: string | Blob,
    options?: SaveFilePickerOptions
  ): Promise<boolean> => {
    if (!isSupported) return false;

    try {
      const handle = await (window as any).showSaveFilePicker(options);
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to save file:', error);
      }
      return false;
    }
  }, [isSupported]);

  const openDirectory = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!isSupported) return null;

    try {
      return await (window as any).showDirectoryPicker();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to open directory:', error);
      }
      return null;
    }
  }, [isSupported]);

  return { isSupported, openFile, saveFile, openDirectory };
}

// ============================================
// 275. Local Storage with Expiry
// ============================================
interface StorageItem<T> {
  value: T;
  expiry: number | null;
}

export function useLocalStorageWithExpiry<T>(
  key: string,
  initialValue: T,
  expiryMs?: number
) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;

    try {
      const item = window.localStorage.getItem(key);
      if (!item) return initialValue;

      const parsed: StorageItem<T> = JSON.parse(item);
      if (parsed.expiry && Date.now() > parsed.expiry) {
        window.localStorage.removeItem(key);
        return initialValue;
      }
      return parsed.value;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue((prev) => {
      const newValue = value instanceof Function ? value(prev) : value;

      const item: StorageItem<T> = {
        value: newValue,
        expiry: expiryMs ? Date.now() + expiryMs : null,
      };

      window.localStorage.setItem(key, JSON.stringify(item));
      return newValue;
    });
  }, [key, expiryMs]);

  const removeValue = useCallback(() => {
    window.localStorage.removeItem(key);
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue] as const;
}

// ============================================
// 276. Session Storage Hook
// ============================================
export function useSessionStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;

    try {
      const item = window.sessionStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setStoredValue((prev) => {
      const newValue = value instanceof Function ? value(prev) : value;
      window.sessionStorage.setItem(key, JSON.stringify(newValue));
      return newValue;
    });
  }, [key]);

  return [storedValue, setValue] as const;
}

// ============================================
// 277. Broadcast Channel Communication
// ============================================
export function useBroadcastChannel<T>(channelName: string) {
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    channelRef.current = new BroadcastChannel(channelName);

    channelRef.current.onmessage = (event) => {
      setLastMessage(event.data);
    };

    return () => {
      channelRef.current?.close();
    };
  }, [channelName]);

  const postMessage = useCallback((message: T) => {
    channelRef.current?.postMessage(message);
  }, []);

  return { lastMessage, postMessage };
}

// ============================================
// 278. Media Session API
// ============================================
export function useMediaSession(options: {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: MediaImage[];
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  onPreviousTrack?: () => void;
  onNextTrack?: () => void;
}) {
  const [isSupported] = useState(() => 'mediaSession' in navigator);

  useEffect(() => {
    if (!isSupported) return;

    const session = navigator.mediaSession;

    if (options.title || options.artist || options.album || options.artwork) {
      session.metadata = new MediaMetadata({
        title: options.title,
        artist: options.artist,
        album: options.album,
        artwork: options.artwork,
      });
    }

    if (options.onPlay) session.setActionHandler('play', options.onPlay);
    if (options.onPause) session.setActionHandler('pause', options.onPause);
    if (options.onSeekBackward) session.setActionHandler('seekbackward', options.onSeekBackward);
    if (options.onSeekForward) session.setActionHandler('seekforward', options.onSeekForward);
    if (options.onPreviousTrack) session.setActionHandler('previoustrack', options.onPreviousTrack);
    if (options.onNextTrack) session.setActionHandler('nexttrack', options.onNextTrack);

    return () => {
      session.setActionHandler('play', null);
      session.setActionHandler('pause', null);
      session.setActionHandler('seekbackward', null);
      session.setActionHandler('seekforward', null);
      session.setActionHandler('previoustrack', null);
      session.setActionHandler('nexttrack', null);
    };
  }, [isSupported, options]);

  return { isSupported };
}

// ============================================
// 279. Periodic Background Sync
// ============================================
export function usePeriodicSync(tag: string, minInterval: number) {
  const [isSupported, setIsSupported] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);

  useEffect(() => {
    const checkSupport = async () => {
      if (!('serviceWorker' in navigator)) return;

      const registration = await navigator.serviceWorker.ready;
      setIsSupported('periodicSync' in registration);
    };

    checkSupport();
  }, []);

  const register = useCallback(async () => {
    if (!isSupported) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).periodicSync.register(tag, { minInterval });
      setIsRegistered(true);
      return true;
    } catch (error) {
      console.error('Periodic sync registration failed:', error);
      return false;
    }
  }, [isSupported, tag, minInterval]);

  const unregister = useCallback(async () => {
    if (!isSupported) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).periodicSync.unregister(tag);
      setIsRegistered(false);
    } catch (error) {
      console.error('Periodic sync unregistration failed:', error);
    }
  }, [isSupported, tag]);

  return { isSupported, isRegistered, register, unregister };
}

// ============================================
// 280. Content Visibility Optimization
// ============================================
export function useContentVisibility() {
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute('data-section-id');
          if (!id) return;

          setVisibleSections((prev) => {
            const next = new Set(prev);
            if (entry.isIntersecting) {
              next.add(id);
            } else {
              next.delete(id);
            }
            return next;
          });
        });
      },
      { rootMargin: '100px' }
    );

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const observeSection = useCallback((element: HTMLElement | null, id: string) => {
    if (!element || !observerRef.current) return;

    element.setAttribute('data-section-id', id);
    element.style.contentVisibility = 'auto';
    element.style.containIntrinsicSize = 'auto 500px';
    observerRef.current.observe(element);
  }, []);

  const unobserveSection = useCallback((element: HTMLElement | null) => {
    if (!element || !observerRef.current) return;
    observerRef.current.unobserve(element);
  }, []);

  return { visibleSections, observeSection, unobserveSection };
}

// Export types
export type {
  ServiceWorkerState,
  IDBStore,
  QueuedRequest,
  CacheOptions,
  PushNotificationState,
  InstallPromptState,
  NetworkInfo,
  StorageItem,
};

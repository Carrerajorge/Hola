/**
 * State Management & Performance Enhancements (221-240)
 * Advanced state management patterns and performance optimizations
 */

import { useState, useCallback, useMemo, useRef, useEffect, createContext, useContext, useReducer, useSyncExternalStore } from 'react';

// ============================================
// 221. Zustand-like Store Factory
// ============================================
type SetState<T> = (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
type GetState<T> = () => T;
type StoreApi<T> = {
  getState: GetState<T>;
  setState: SetState<T>;
  subscribe: (listener: (state: T) => void) => () => void;
  destroy: () => void;
};

export function createStore<T extends object>(initialState: T): StoreApi<T> {
  let state = initialState;
  const listeners = new Set<(state: T) => void>();

  const getState: GetState<T> = () => state;

  const setState: SetState<T> = (partial) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...nextState };
    listeners.forEach((listener) => listener(state));
  };

  const subscribe = (listener: (state: T) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const destroy = () => {
    listeners.clear();
  };

  return { getState, setState, subscribe, destroy };
}

export function useStore<T extends object, U>(
  store: StoreApi<T>,
  selector: (state: T) => U = (state) => state as unknown as U
): U {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState())
  );
}

// ============================================
// 222. Immer-like State Updates
// ============================================
type Draft<T> = T;

export function produce<T>(base: T, recipe: (draft: Draft<T>) => void): T {
  const copy = JSON.parse(JSON.stringify(base));
  recipe(copy);
  return copy;
}

export function useImmer<T>(initialValue: T): [T, (updater: (draft: Draft<T>) => void) => void] {
  const [state, setState] = useState(initialValue);

  const updateState = useCallback((updater: (draft: Draft<T>) => void) => {
    setState((currentState) => produce(currentState, updater));
  }, []);

  return [state, updateState];
}

// ============================================
// 223. Atomic State Management
// ============================================
type Atom<T> = {
  key: string;
  default: T;
};

const atomRegistry = new Map<string, StoreApi<any>>();

export function atom<T>(config: { key: string; default: T }): Atom<T> {
  return config;
}

export function useAtom<T>(atomConfig: Atom<T>): [T, (value: T | ((prev: T) => T)) => void] {
  let store = atomRegistry.get(atomConfig.key);

  if (!store) {
    store = createStore({ value: atomConfig.default });
    atomRegistry.set(atomConfig.key, store);
  }

  const state = useStore(store, (s) => s.value as T);

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    const currentStore = atomRegistry.get(atomConfig.key)!;
    const currentValue = currentStore.getState().value;
    const newValue = typeof value === 'function' ? (value as (prev: T) => T)(currentValue) : value;
    currentStore.setState({ value: newValue });
  }, [atomConfig.key]);

  return [state, setValue];
}

// ============================================
// 224. Selector with Memoization
// ============================================
export function createSelector<T, R>(
  selector: (state: T) => R,
  equalityFn: (a: R, b: R) => boolean = Object.is
) {
  let lastState: T | undefined;
  let lastResult: R | undefined;

  return (state: T): R => {
    if (lastState === state) {
      return lastResult!;
    }

    const result = selector(state);

    if (lastResult !== undefined && equalityFn(lastResult, result)) {
      return lastResult;
    }

    lastState = state;
    lastResult = result;
    return result;
  };
}

// ============================================
// 225. Async State Machine
// ============================================
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

export function useAsyncState<T>() {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' });

  const execute = useCallback(async (promise: Promise<T>) => {
    setState({ status: 'loading' });
    try {
      const data = await promise;
      setState({ status: 'success', data });
      return data;
    } catch (error) {
      setState({ status: 'error', error: error as Error });
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return {
    ...state,
    isIdle: state.status === 'idle',
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    data: state.status === 'success' ? state.data : undefined,
    error: state.status === 'error' ? state.error : undefined,
    execute,
    reset,
  };
}

// ============================================
// 226. Query Cache Manager
// ============================================
interface QueryCacheEntry<T> {
  data: T;
  timestamp: number;
  staleTime: number;
}

class QueryCache {
  private cache = new Map<string, QueryCacheEntry<any>>();
  private subscribers = new Map<string, Set<() => void>>();

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > entry.staleTime) {
      return undefined; // Stale
    }

    return entry.data;
  }

  set<T>(key: string, data: T, staleTime: number = 5 * 60 * 1000): void {
    this.cache.set(key, { data, timestamp: Date.now(), staleTime });
    this.notify(key);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
    this.notify(key);
  }

  invalidateAll(): void {
    const keys = Array.from(this.cache.keys());
    this.cache.clear();
    keys.forEach((key) => this.notify(key));
  }

  subscribe(key: string, callback: () => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => this.subscribers.get(key)?.delete(callback);
  }

  private notify(key: string): void {
    this.subscribers.get(key)?.forEach((cb) => cb());
  }
}

export const queryCache = new QueryCache();

// ============================================
// 227. useQuery Hook with Caching
// ============================================
interface UseQueryOptions<T> {
  queryKey: string;
  queryFn: () => Promise<T>;
  staleTime?: number;
  cacheTime?: number;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  refetchOnWindowFocus?: boolean;
  refetchInterval?: number;
}

export function useQuery<T>(options: UseQueryOptions<T>) {
  const {
    queryKey,
    queryFn,
    staleTime = 5 * 60 * 1000,
    enabled = true,
    onSuccess,
    onError,
    refetchOnWindowFocus = true,
    refetchInterval,
  } = options;

  const [state, setState] = useState<AsyncState<T>>(() => {
    const cached = queryCache.get<T>(queryKey);
    return cached ? { status: 'success', data: cached } : { status: 'idle' };
  });

  const fetchData = useCallback(async () => {
    setState((prev) =>
      prev.status === 'success' ? prev : { status: 'loading' }
    );

    try {
      const data = await queryFn();
      queryCache.set(queryKey, data, staleTime);
      setState({ status: 'success', data });
      onSuccess?.(data);
    } catch (error) {
      setState({ status: 'error', error: error as Error });
      onError?.(error as Error);
    }
  }, [queryKey, queryFn, staleTime, onSuccess, onError]);

  useEffect(() => {
    if (!enabled) return;

    const cached = queryCache.get<T>(queryKey);
    if (!cached) {
      fetchData();
    }

    return queryCache.subscribe(queryKey, () => {
      const data = queryCache.get<T>(queryKey);
      if (data) {
        setState({ status: 'success', data });
      }
    });
  }, [enabled, queryKey, fetchData]);

  useEffect(() => {
    if (!refetchOnWindowFocus || !enabled) return;

    const handleFocus = () => {
      const cached = queryCache.get<T>(queryKey);
      if (!cached) {
        fetchData();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetchOnWindowFocus, enabled, queryKey, fetchData]);

  useEffect(() => {
    if (!refetchInterval || !enabled) return;

    const interval = setInterval(fetchData, refetchInterval);
    return () => clearInterval(interval);
  }, [refetchInterval, enabled, fetchData]);

  return {
    ...state,
    data: state.status === 'success' ? state.data : undefined,
    error: state.status === 'error' ? state.error : undefined,
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    refetch: fetchData,
  };
}

// ============================================
// 228. useMutation Hook
// ============================================
interface UseMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void;
  invalidateQueries?: string[];
}

export function useMutation<TData, TVariables>(
  options: UseMutationOptions<TData, TVariables>
) {
  const { mutationFn, onSuccess, onError, onSettled, invalidateQueries } = options;
  const [state, setState] = useState<AsyncState<TData>>({ status: 'idle' });

  const mutate = useCallback(async (variables: TVariables) => {
    setState({ status: 'loading' });

    try {
      const data = await mutationFn(variables);
      setState({ status: 'success', data });
      onSuccess?.(data, variables);
      invalidateQueries?.forEach((key) => queryCache.invalidate(key));
      onSettled?.(data, null, variables);
      return data;
    } catch (error) {
      setState({ status: 'error', error: error as Error });
      onError?.(error as Error, variables);
      onSettled?.(undefined, error as Error, variables);
      throw error;
    }
  }, [mutationFn, onSuccess, onError, onSettled, invalidateQueries]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return {
    ...state,
    data: state.status === 'success' ? state.data : undefined,
    error: state.status === 'error' ? state.error : undefined,
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    mutate,
    mutateAsync: mutate,
    reset,
  };
}

// ============================================
// 229. Optimistic Updates
// ============================================
export function useOptimisticUpdate<T, TVariables>(
  queryKey: string,
  updateFn: (old: T | undefined, variables: TVariables) => T
) {
  const rollbackRef = useRef<T | undefined>();

  const optimisticUpdate = useCallback((variables: TVariables) => {
    rollbackRef.current = queryCache.get<T>(queryKey);
    const optimisticData = updateFn(rollbackRef.current, variables);
    queryCache.set(queryKey, optimisticData);
  }, [queryKey, updateFn]);

  const rollback = useCallback(() => {
    if (rollbackRef.current !== undefined) {
      queryCache.set(queryKey, rollbackRef.current);
    }
  }, [queryKey]);

  const confirm = useCallback(() => {
    rollbackRef.current = undefined;
  }, []);

  return { optimisticUpdate, rollback, confirm };
}

// ============================================
// 230. Virtual List for Large Data Sets
// ============================================
interface VirtualListOptions {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

export function useVirtualList(options: VirtualListOptions) {
  const { itemCount, itemHeight, containerHeight, overscan = 3 } = options;
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = itemCount * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    itemCount - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = useMemo(() => {
    const items = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        style: {
          position: 'absolute' as const,
          top: i * itemHeight,
          height: itemHeight,
          left: 0,
          right: 0,
        },
      });
    }
    return items;
  }, [startIndex, endIndex, itemHeight]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    totalHeight,
    visibleItems,
    handleScroll,
    containerStyle: {
      height: containerHeight,
      overflow: 'auto' as const,
      position: 'relative' as const,
    },
    innerStyle: {
      height: totalHeight,
      position: 'relative' as const,
    },
  };
}

// ============================================
// 231. Debounced State
// ============================================
export function useDebouncedState<T>(initialValue: T, delay: number = 300): [T, T, (value: T) => void] {
  const [value, setValue] = useState(initialValue);
  const [debouncedValue, setDebouncedValue] = useState(initialValue);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const setValueDebounced = useCallback((newValue: T) => {
    setValue(newValue);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedValue(newValue);
    }, delay);
  }, [delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [value, debouncedValue, setValueDebounced];
}

// ============================================
// 232. Throttled Callback
// ============================================
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const lastArgs = useRef<Parameters<T>>();

  return useCallback((...args: Parameters<T>) => {
    const now = Date.now();
    lastArgs.current = args;

    if (now - lastRun.current >= delay) {
      lastRun.current = now;
      callback(...args);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        lastRun.current = Date.now();
        callback(...lastArgs.current!);
      }, delay - (now - lastRun.current));
    }
  }, [callback, delay]) as T;
}

// ============================================
// 233. Web Worker Integration
// ============================================
export function useWebWorker<T, R>(workerFunction: (data: T) => R) {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const workerCode = `
      self.onmessage = function(e) {
        try {
          const fn = ${workerFunction.toString()};
          const result = fn(e.data);
          self.postMessage({ success: true, result });
        } catch (error) {
          self.postMessage({ success: false, error: error.message });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));

    workerRef.current.onmessage = (e) => {
      setIsProcessing(false);
      if (e.data.success) {
        setResult(e.data.result);
        setError(null);
      } else {
        setError(new Error(e.data.error));
        setResult(null);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, [workerFunction]);

  const execute = useCallback((data: T) => {
    setIsProcessing(true);
    workerRef.current?.postMessage(data);
  }, []);

  return { result, error, isProcessing, execute };
}

// ============================================
// 234. Request Animation Frame Hook
// ============================================
export function useAnimationFrame(callback: (deltaTime: number) => void, deps: any[] = []) {
  const requestRef = useRef<number>();
  const previousTimeRef = useRef<number>();

  useEffect(() => {
    const animate = (time: number) => {
      if (previousTimeRef.current !== undefined) {
        const deltaTime = time - previousTimeRef.current;
        callback(deltaTime);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, deps);
}

// ============================================
// 235. Intersection Observer Hook
// ============================================
interface UseIntersectionObserverOptions {
  threshold?: number | number[];
  root?: Element | null;
  rootMargin?: string;
  freezeOnceVisible?: boolean;
}

export function useIntersectionObserver(
  elementRef: React.RefObject<Element>,
  options: UseIntersectionObserverOptions = {}
) {
  const { threshold = 0, root = null, rootMargin = '0px', freezeOnceVisible = false } = options;
  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);

  const frozen = entry?.isIntersecting && freezeOnceVisible;

  useEffect(() => {
    const node = elementRef.current;
    const hasIOSupport = !!window.IntersectionObserver;

    if (!hasIOSupport || frozen || !node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setEntry(entry),
      { threshold, root, rootMargin }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [elementRef, threshold, root, rootMargin, frozen]);

  return entry;
}

// ============================================
// 236. Resize Observer Hook
// ============================================
interface Size {
  width: number;
  height: number;
}

export function useResizeObserver(elementRef: React.RefObject<Element>): Size | undefined {
  const [size, setSize] = useState<Size>();

  useEffect(() => {
    const node = elementRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [elementRef]);

  return size;
}

// ============================================
// 237. Memory Leak Prevention
// ============================================
export function useSafeState<T>(initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(initialValue);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((value: T | ((prev: T) => T)) => {
    if (mountedRef.current) {
      setState(value);
    }
  }, []);

  return [state, safeSetState];
}

// ============================================
// 238. Previous Value Hook
// ============================================
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// ============================================
// 239. State History Hook
// ============================================
export function useStateHistory<T>(initialValue: T, maxHistory: number = 10) {
  const [state, setState] = useState(initialValue);
  const historyRef = useRef<T[]>([initialValue]);
  const indexRef = useRef(0);

  const setWithHistory = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const newValue = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;

      // Truncate future history
      historyRef.current = historyRef.current.slice(0, indexRef.current + 1);
      historyRef.current.push(newValue);

      // Limit history size
      if (historyRef.current.length > maxHistory) {
        historyRef.current.shift();
      } else {
        indexRef.current++;
      }

      return newValue;
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    if (indexRef.current > 0) {
      indexRef.current--;
      setState(historyRef.current[indexRef.current]);
    }
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++;
      setState(historyRef.current[indexRef.current]);
    }
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  return {
    state,
    set: setWithHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    history: historyRef.current,
    historyIndex: indexRef.current,
  };
}

// ============================================
// 240. Performance Monitor
// ============================================
interface PerformanceMetrics {
  renderCount: number;
  lastRenderTime: number;
  averageRenderTime: number;
  slowRenders: number;
}

const SLOW_RENDER_THRESHOLD = 16; // 60fps threshold

export function usePerformanceMonitor(componentName: string): PerformanceMetrics {
  const metricsRef = useRef<PerformanceMetrics>({
    renderCount: 0,
    lastRenderTime: 0,
    averageRenderTime: 0,
    slowRenders: 0,
  });
  const renderTimesRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    const endTime = performance.now();
    const renderTime = endTime - startTimeRef.current;

    metricsRef.current.renderCount++;
    metricsRef.current.lastRenderTime = renderTime;
    renderTimesRef.current.push(renderTime);

    // Keep only last 100 renders
    if (renderTimesRef.current.length > 100) {
      renderTimesRef.current.shift();
    }

    metricsRef.current.averageRenderTime =
      renderTimesRef.current.reduce((a, b) => a + b, 0) / renderTimesRef.current.length;

    if (renderTime > SLOW_RENDER_THRESHOLD) {
      metricsRef.current.slowRenders++;
      console.warn(`[Performance] ${componentName} slow render: ${renderTime.toFixed(2)}ms`);
    }

    startTimeRef.current = performance.now();
  });

  return metricsRef.current;
}

// Export all hooks and utilities
export {
  AsyncState,
  QueryCacheEntry,
  UseQueryOptions,
  UseMutationOptions,
  VirtualListOptions,
  UseIntersectionObserverOptions,
  Size,
  PerformanceMetrics,
};

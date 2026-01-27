/**
 * Advanced UI Components Library
 *
 * Enhanced components with accessibility, animations, and advanced features.
 * Implements Frontend improvements 201-220
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface ToastConfig {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export interface ModalConfig {
  id: string;
  title: string;
  content: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  closable?: boolean;
  onClose?: () => void;
}

export interface ConfirmConfig {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

// ============================================================================
// TOAST SYSTEM (Improvement 201-203)
// ============================================================================

type ToastListener = (toasts: ToastConfig[]) => void;

class ToastManager {
  private toasts: ToastConfig[] = [];
  private listeners: Set<ToastListener> = new Set();
  private counter = 0;

  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener([...this.toasts]));
  }

  show(config: Omit<ToastConfig, 'id'>): string {
    const id = `toast_${++this.counter}`;
    const toast: ToastConfig = { ...config, id };

    this.toasts.push(toast);
    this.notify();

    // Auto-dismiss
    const duration = config.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }

    return id;
  }

  success(title: string, message?: string): string {
    return this.show({ type: 'success', title, message });
  }

  error(title: string, message?: string): string {
    return this.show({ type: 'error', title, message, duration: 8000 });
  }

  warning(title: string, message?: string): string {
    return this.show({ type: 'warning', title, message });
  }

  info(title: string, message?: string): string {
    return this.show({ type: 'info', title, message });
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }

  dismissAll(): void {
    this.toasts = [];
    this.notify();
  }
}

export const toastManager = new ToastManager();

export function useToasts() {
  const [toasts, setToasts] = useState<ToastConfig[]>([]);

  useEffect(() => {
    return toastManager.subscribe(setToasts);
  }, []);

  return {
    toasts,
    show: toastManager.show.bind(toastManager),
    success: toastManager.success.bind(toastManager),
    error: toastManager.error.bind(toastManager),
    warning: toastManager.warning.bind(toastManager),
    info: toastManager.info.bind(toastManager),
    dismiss: toastManager.dismiss.bind(toastManager),
    dismissAll: toastManager.dismissAll.bind(toastManager)
  };
}

// ============================================================================
// MODAL SYSTEM (Improvement 204-206)
// ============================================================================

type ModalListener = (modals: ModalConfig[]) => void;

class ModalManager {
  private modals: ModalConfig[] = [];
  private listeners: Set<ModalListener> = new Set();
  private counter = 0;

  subscribe(listener: ModalListener): () => void {
    this.listeners.add(listener);
    listener(this.modals);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener([...this.modals]));
  }

  open(config: Omit<ModalConfig, 'id'>): string {
    const id = `modal_${++this.counter}`;
    const modal: ModalConfig = { ...config, id, closable: config.closable ?? true };

    this.modals.push(modal);
    this.notify();

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    return id;
  }

  close(id: string): void {
    const modal = this.modals.find(m => m.id === id);
    if (modal?.onClose) modal.onClose();

    this.modals = this.modals.filter(m => m.id !== id);
    this.notify();

    if (this.modals.length === 0) {
      document.body.style.overflow = '';
    }
  }

  closeAll(): void {
    this.modals.forEach(m => m.onClose?.());
    this.modals = [];
    this.notify();
    document.body.style.overflow = '';
  }

  isOpen(id: string): boolean {
    return this.modals.some(m => m.id === id);
  }
}

export const modalManager = new ModalManager();

export function useModals() {
  const [modals, setModals] = useState<ModalConfig[]>([]);

  useEffect(() => {
    return modalManager.subscribe(setModals);
  }, []);

  return {
    modals,
    open: modalManager.open.bind(modalManager),
    close: modalManager.close.bind(modalManager),
    closeAll: modalManager.closeAll.bind(modalManager),
    isOpen: modalManager.isOpen.bind(modalManager)
  };
}

// ============================================================================
// CONFIRM DIALOG (Improvement 207-208)
// ============================================================================

type ConfirmResolver = (confirmed: boolean) => void;

class ConfirmManager {
  private resolver: ConfirmResolver | null = null;
  private config: ConfirmConfig | null = null;
  private listeners: Set<(config: ConfirmConfig | null) => void> = new Set();

  subscribe(listener: (config: ConfirmConfig | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.config);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener(this.config));
  }

  async confirm(config: ConfirmConfig): Promise<boolean> {
    this.config = config;
    this.notify();

    return new Promise<boolean>(resolve => {
      this.resolver = resolve;
    });
  }

  resolve(confirmed: boolean): void {
    if (this.resolver) {
      this.resolver(confirmed);
      this.resolver = null;
    }
    this.config = null;
    this.notify();
  }
}

export const confirmManager = new ConfirmManager();

export function useConfirm() {
  const [config, setConfig] = useState<ConfirmConfig | null>(null);

  useEffect(() => {
    return confirmManager.subscribe(setConfig);
  }, []);

  return {
    config,
    confirm: confirmManager.confirm.bind(confirmManager),
    resolve: confirmManager.resolve.bind(confirmManager)
  };
}

// ============================================================================
// LOADING STATE (Improvement 209-210)
// ============================================================================

interface LoadingState {
  isLoading: boolean;
  message?: string;
  progress?: number;
}

type LoadingListener = (state: LoadingState) => void;

class LoadingManager {
  private state: LoadingState = { isLoading: false };
  private listeners: Set<LoadingListener> = new Set();
  private loadingCount = 0;

  subscribe(listener: LoadingListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  start(message?: string): void {
    this.loadingCount++;
    this.state = { isLoading: true, message, progress: undefined };
    this.notify();
  }

  setProgress(progress: number, message?: string): void {
    this.state = { ...this.state, progress, message: message ?? this.state.message };
    this.notify();
  }

  stop(): void {
    this.loadingCount = Math.max(0, this.loadingCount - 1);
    if (this.loadingCount === 0) {
      this.state = { isLoading: false };
      this.notify();
    }
  }

  forceStop(): void {
    this.loadingCount = 0;
    this.state = { isLoading: false };
    this.notify();
  }
}

export const loadingManager = new LoadingManager();

export function useLoading() {
  const [state, setState] = useState<LoadingState>({ isLoading: false });

  useEffect(() => {
    return loadingManager.subscribe(setState);
  }, []);

  return {
    ...state,
    start: loadingManager.start.bind(loadingManager),
    setProgress: loadingManager.setProgress.bind(loadingManager),
    stop: loadingManager.stop.bind(loadingManager),
    forceStop: loadingManager.forceStop.bind(loadingManager)
  };
}

// ============================================================================
// KEYBOARD SHORTCUTS (Improvement 211-213)
// ============================================================================

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  action: () => void;
  description?: string;
  enabled?: boolean;
}

class KeyboardShortcutManager {
  private shortcuts: Map<string, ShortcutConfig> = new Map();
  private enabled = true;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown.bind(this));
    }
  }

  private getShortcutKey(e: KeyboardEvent | ShortcutConfig): string {
    const parts: string[] = [];
    if ('ctrlKey' in e ? e.ctrlKey : e.ctrl) parts.push('ctrl');
    if ('shiftKey' in e ? e.shiftKey : e.shift) parts.push('shift');
    if ('altKey' in e ? e.altKey : e.alt) parts.push('alt');
    if ('metaKey' in e ? e.metaKey : e.meta) parts.push('meta');
    parts.push(('key' in e && typeof e.key === 'string' ? e.key : (e as ShortcutConfig).key).toLowerCase());
    return parts.join('+');
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Ignore if typing in input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      // Allow certain shortcuts even in inputs
      if (!e.ctrlKey && !e.metaKey) return;
    }

    const key = this.getShortcutKey(e);
    const shortcut = this.shortcuts.get(key);

    if (shortcut && shortcut.enabled !== false) {
      e.preventDefault();
      shortcut.action();
    }
  }

  register(config: ShortcutConfig): () => void {
    const key = this.getShortcutKey(config);
    this.shortcuts.set(key, config);
    return () => this.shortcuts.delete(key);
  }

  unregister(config: Pick<ShortcutConfig, 'key' | 'ctrl' | 'shift' | 'alt' | 'meta'>): void {
    const key = this.getShortcutKey(config as ShortcutConfig);
    this.shortcuts.delete(key);
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  getAll(): ShortcutConfig[] {
    return Array.from(this.shortcuts.values());
  }
}

export const keyboardShortcuts = new KeyboardShortcutManager();

export function useKeyboardShortcut(config: ShortcutConfig) {
  useEffect(() => {
    return keyboardShortcuts.register(config);
  }, [config.key, config.ctrl, config.shift, config.alt, config.meta]);
}

// ============================================================================
// CLIPBOARD (Improvement 214-215)
// ============================================================================

export function useClipboard() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
      return true;
    } catch (error) {
      console.error('Failed to copy:', error);
      return false;
    }
  }, []);

  const paste = useCallback(async (): Promise<string | null> => {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to paste:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { copy, paste, copied };
}

// ============================================================================
// FORM HELPERS (Improvement 216-218)
// ============================================================================

interface FormField<T> {
  value: T;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

interface FormState<T extends Record<string, any>> {
  fields: { [K in keyof T]: FormField<T[K]> };
  isValid: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
}

type Validator<T> = (value: T, allValues: Record<string, any>) => string | undefined;

export function useForm<T extends Record<string, any>>(
  initialValues: T,
  validators?: { [K in keyof T]?: Validator<T[K]> }
) {
  const [state, setState] = useState<FormState<T>>(() => {
    const fields = {} as FormState<T>['fields'];
    for (const key in initialValues) {
      fields[key] = {
        value: initialValues[key],
        touched: false,
        dirty: false
      };
    }
    return { fields, isValid: true, isSubmitting: false, isDirty: false };
  });

  const validate = useCallback((fieldName: keyof T, value: T[keyof T]): string | undefined => {
    const validator = validators?.[fieldName];
    if (!validator) return undefined;

    const allValues: Record<string, any> = {};
    for (const key in state.fields) {
      allValues[key] = state.fields[key].value;
    }
    allValues[fieldName as string] = value;

    return validator(value, allValues);
  }, [validators, state.fields]);

  const setValue = useCallback(<K extends keyof T>(fieldName: K, value: T[K]) => {
    setState(prev => {
      const error = validate(fieldName, value);
      const newFields = {
        ...prev.fields,
        [fieldName]: {
          value,
          error,
          touched: prev.fields[fieldName].touched,
          dirty: value !== initialValues[fieldName]
        }
      };

      const isValid = Object.values(newFields).every(f => !f.error);
      const isDirty = Object.values(newFields).some(f => f.dirty);

      return { ...prev, fields: newFields, isValid, isDirty };
    });
  }, [validate, initialValues]);

  const setTouched = useCallback(<K extends keyof T>(fieldName: K) => {
    setState(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: { ...prev.fields[fieldName], touched: true }
      }
    }));
  }, []);

  const reset = useCallback(() => {
    const fields = {} as FormState<T>['fields'];
    for (const key in initialValues) {
      fields[key] = {
        value: initialValues[key],
        touched: false,
        dirty: false
      };
    }
    setState({ fields, isValid: true, isSubmitting: false, isDirty: false });
  }, [initialValues]);

  const getValues = useCallback((): T => {
    const values = {} as T;
    for (const key in state.fields) {
      values[key] = state.fields[key].value;
    }
    return values;
  }, [state.fields]);

  const handleSubmit = useCallback((onSubmit: (values: T) => Promise<void> | void) => {
    return async (e?: React.FormEvent) => {
      e?.preventDefault();

      // Validate all fields
      let hasErrors = false;
      const newFields = { ...state.fields };

      for (const key in newFields) {
        const error = validate(key as keyof T, newFields[key].value);
        newFields[key] = { ...newFields[key], error, touched: true };
        if (error) hasErrors = true;
      }

      setState(prev => ({ ...prev, fields: newFields, isValid: !hasErrors }));

      if (hasErrors) return;

      setState(prev => ({ ...prev, isSubmitting: true }));

      try {
        await onSubmit(getValues());
      } finally {
        setState(prev => ({ ...prev, isSubmitting: false }));
      }
    };
  }, [state.fields, validate, getValues]);

  return {
    fields: state.fields,
    isValid: state.isValid,
    isSubmitting: state.isSubmitting,
    isDirty: state.isDirty,
    setValue,
    setTouched,
    reset,
    getValues,
    handleSubmit
  };
}

// ============================================================================
// INFINITE SCROLL (Improvement 219-220)
// ============================================================================

interface InfiniteScrollOptions {
  threshold?: number;
  rootMargin?: string;
}

export function useInfiniteScroll(
  callback: () => void,
  hasMore: boolean,
  options: InfiniteScrollOptions = {}
) {
  const { threshold = 0.5, rootMargin = '100px' } = options;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          callback();
        }
      },
      { threshold, rootMargin }
    );

    observerRef.current = observer;

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [callback, hasMore, threshold, rootMargin]);

  return loadMoreRef;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  toastManager,
  modalManager,
  confirmManager,
  loadingManager,
  keyboardShortcuts,
  useToasts,
  useModals,
  useConfirm,
  useLoading,
  useKeyboardShortcut,
  useClipboard,
  useForm,
  useInfiniteScroll
};

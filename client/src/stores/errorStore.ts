import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { AppError, ErrorContext } from "@/lib/errors";
import { classifyError, getUserErrorMessage, shouldRetry } from "@/lib/errors";
import { chatLogger } from "@/lib/logger";

export interface ErrorState {
  // Active errors
  errors: AppError[];
  lastError: AppError | null;
  
  // Error history (for debugging)
  errorHistory: AppError[];
  maxHistorySize: number;
  
  // Actions
  addError: (error: unknown, context?: ErrorContext) => AppError;
  clearError: (errorId: string) => void;
  clearAllErrors: () => void;
  retryError: (errorId: string) => void;
  markErrorAsHandled: (errorId: string) => void;
  
  // Stats
  getErrorCount: (category?: string) => number;
  getRecentErrors: (count?: number) => AppError[];
}

export const useErrorStore = create<ErrorState>()(
  subscribeWithSelector((set, get) => ({
    errors: [],
    lastError: null,
    errorHistory: [],
    maxHistorySize: 100,
    
    addError: (error: unknown, context?: ErrorContext) => {
      const appError = classifyError(error, context);
      
      chatLogger.error("Error added to store", appError.toJSON());
      
      set((state) => {
        // Add to active errors
        const newErrors = [...state.errors, appError];
        
        // Add to history
        const newHistory = [...state.errorHistory, appError]
          .slice(-state.maxHistorySize);
        
        return {
          errors: newErrors,
          lastError: appError,
          errorHistory: newHistory,
        };
      });
      
      // Report to analytics if critical or high severity
      if (appError.severity === "critical" || appError.severity === "high") {
        reportErrorToAnalytics(appError);
      }
      
      return appError;
    },
    
    clearError: (errorId: string) => {
      set((state) => ({
        errors: state.errors.filter((e) => e.id !== errorId),
      }));
    },
    
    clearAllErrors: () => {
      set({ errors: [], lastError: null });
    },
    
    retryError: (errorId: string) => {
      const error = get().errors.find((e) => e.id === errorId);
      if (!error) return;
      
      if (shouldRetry(error)) {
        error.retryCount++;
        chatLogger.info(`Retrying error ${errorId}`, { retryCount: error.retryCount });
      } else {
        chatLogger.warn(`Cannot retry error ${errorId}`, { reason: "Max retries exceeded or not retryable" });
      }
    },
    
    markErrorAsHandled: (errorId: string) => {
      set((state) => ({
        errors: state.errors.map((e) =>
          e.id === errorId ? { ...e, retryable: false } : e
        ),
      }));
    },
    
    getErrorCount: (category?: string) => {
      const { errors } = get();
      if (!category) return errors.length;
      return errors.filter((e) => e.category === category).length;
    },
    
    getRecentErrors: (count: number = 10) => {
      return get().errorHistory.slice(-count);
    },
  }))
);

// Analytics reporting function
function reportErrorToAnalytics(error: AppError): void {
  // Send to analytics service (e.g., Sentry, LogRocket)
  if (typeof window !== "undefined" && (window as any).analytics) {
    (window as any).analytics.track("Error Occurred", {
      errorId: error.id,
      category: error.category,
      severity: error.severity,
      message: error.message,
      component: error.context?.component,
      action: error.context?.action,
    });
  }
}

// Selectors
export function useActiveErrors() {
  return useErrorStore((state) => state.errors);
}

export function useLastError() {
  return useErrorStore((state) => state.lastError);
}

export function useErrorCount(category?: string) {
  return useErrorStore((state) => state.getErrorCount(category));
}

// Error display component helper
export function useErrorDisplay() {
  const addError = useErrorStore((state) => state.addError);
  const clearError = useErrorStore((state) => state.clearError);
  const clearAll = useErrorStore((state) => state.clearAllErrors);
  const retryError = useErrorStore((state) => state.retryError);
  
  return {
    addError,
    clearError,
    clearAll,
    retryError,
    getUserErrorMessage,
    shouldRetry,
  };
}

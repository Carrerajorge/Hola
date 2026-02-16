import { AsyncLocalStorage } from "async_hooks";

export interface CorrelationContext {
  traceId: string;
  userId?: string;
  startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

export function getContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getTraceId(): string | undefined {
  return asyncLocalStorage.getStore()?.traceId;
}

export function getUserId(): string | undefined {
  return asyncLocalStorage.getStore()?.userId;
}

export function setContext(context: CorrelationContext): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

export function runWithContext<T>(context: CorrelationContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function updateContext(updates: Partial<CorrelationContext>): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, updates);
  }
}

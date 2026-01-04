import { useAgentStore } from '@/stores/agent-store';

interface PollingInstance {
  runId: string;
  messageId: string;
  intervalRef: NodeJS.Timeout | null;
  abortController: AbortController | null;
  currentInterval: number;
  retryCount: number;
  lastEventCount: number;
}

interface PollingManagerOptions {
  initialInterval: number;
  maxInterval: number;
  backoffMultiplier: number;
  maxRetries: number;
}

const DEFAULT_OPTIONS: PollingManagerOptions = {
  initialInterval: 500,
  maxInterval: 5000,
  backoffMultiplier: 1.5,
  maxRetries: 3,
};

class PollingManager {
  private instances: Map<string, PollingInstance> = new Map();
  private options: PollingManagerOptions;

  constructor(options: Partial<PollingManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(messageId: string, runId: string): void {
    if (this.instances.has(runId)) {
      return;
    }

    const instance: PollingInstance = {
      runId,
      messageId,
      intervalRef: null,
      abortController: null,
      currentInterval: this.options.initialInterval,
      retryCount: 0,
      lastEventCount: 0,
    };

    this.instances.set(runId, instance);
    useAgentStore.getState().startPolling(messageId);
    this.poll(runId);
  }

  stop(runId: string): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    this.clearInstance(instance);
    this.instances.delete(runId);
    useAgentStore.getState().stopPolling(instance.messageId);
  }

  cancel(runId: string): void {
    const instance = this.instances.get(runId);
    if (instance?.abortController) {
      instance.abortController.abort();
    }
    this.stop(runId);
  }

  isPolling(runId: string): boolean {
    return this.instances.has(runId);
  }

  cancelAll(): void {
    const runIds = Array.from(this.instances.keys());
    for (const runId of runIds) {
      this.cancel(runId);
    }
  }

  handleHydratedRun(messageId: string, runId: string, status: string): void {
    if (['starting', 'queued', 'planning', 'running'].includes(status)) {
      this.start(messageId, runId);
    }
  }

  private clearInstance(instance: PollingInstance): void {
    if (instance.intervalRef) {
      clearTimeout(instance.intervalRef);
      instance.intervalRef = null;
    }
    if (instance.abortController) {
      instance.abortController.abort();
      instance.abortController = null;
    }
  }

  private async poll(runId: string): Promise<void> {
    const instance = this.instances.get(runId);
    if (!instance) return;

    instance.abortController = new AbortController();

    try {
      const response = await fetch(`/api/agent/runs/${runId}`, {
        signal: instance.abortController.signal,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const store = useAgentStore.getState();

      if (data.status === 'completed') {
        store.updateRun(instance.messageId, {
          status: 'completed',
          eventStream: data.eventStream || [],
          summary: data.summary || data.result || '',
        });
        store.stopPolling(instance.messageId);
        this.stop(runId);
        return;
      }

      if (data.status === 'failed' || data.status === 'cancelled') {
        store.updateRun(instance.messageId, {
          status: data.status,
          eventStream: data.eventStream || [],
          error: data.error || 'Run ended',
        });
        store.stopPolling(instance.messageId);
        this.stop(runId);
        return;
      }

      store.updateRun(instance.messageId, {
        status: data.status,
        eventStream: data.eventStream || [],
        steps: data.steps || [],
        summary: data.summary,
      });

      const newEventCount = data.eventStream?.length || 0;
      if (newEventCount > instance.lastEventCount) {
        instance.currentInterval = this.options.initialInterval;
        instance.lastEventCount = newEventCount;
      } else {
        instance.currentInterval = Math.min(
          instance.currentInterval * this.options.backoffMultiplier,
          this.options.maxInterval
        );
      }

      instance.retryCount = 0;
      this.scheduleNext(runId, instance.currentInterval);

    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }

      instance.retryCount++;
      if (instance.retryCount >= this.options.maxRetries) {
        const store = useAgentStore.getState();
        store.failRun(instance.messageId, 'Polling failed after max retries');
        this.stop(runId);
        return;
      }

      const backoffDelay = instance.currentInterval * Math.pow(this.options.backoffMultiplier, instance.retryCount);
      this.scheduleNext(runId, Math.min(backoffDelay, this.options.maxInterval));
    }
  }

  private scheduleNext(runId: string, delay: number): void {
    const instance = this.instances.get(runId);
    if (!instance) return;

    instance.intervalRef = setTimeout(() => {
      this.poll(runId);
    }, delay);
  }
}

export const pollingManager = new PollingManager();

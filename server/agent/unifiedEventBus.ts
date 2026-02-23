import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { emitDashboardEvent } from '../telemetry/emitter.js';
import { createEvent } from '../telemetry/eventSchema.js';

export type EventTopic = 'system.*' | 'vision.*' | 'agent.*' | 'telemetry.*' | 'user.*' | 'workflow.*' | string;

export interface UnifiedEvent {
    topic: string;
    payload: any;
    timestamp: number;
    id: string;
    retries?: number;
}

export class UnifiedEventBus extends EventEmitter {
    public deadLetterQueue: UnifiedEvent[] = [];
    private metrics: Map<EventTopic, { count: number; bytes: number }> = new Map();
    private dlqTimer: NodeJS.Timeout;

    constructor() {
        super();
        this.setMaxListeners(200);

        this.dlqTimer = setInterval(() => {
            this.processDLQ();
        }, 30000);
    }

    async publish(topic: string, payload: any, retryContext?: UnifiedEvent): Promise<void> {
        const event: UnifiedEvent = retryContext || {
            topic,
            payload,
            timestamp: Date.now(),
            id: randomUUID(),
            retries: 0
        };

        if (!retryContext) {
            this.updateMetrics(topic, JSON.stringify(payload).length);
        }

        try {
            // Emitir en el topic exacto
            this.emit(topic, event);

            // Emitir para los escuchas del wildcard (ej: vision.*)
            const parts = topic.split('.');
            if (parts.length > 1) {
                const baseTopic = parts[0] + '.*';
                this.emit(baseTopic, event);
            }

            // Persistence via telemetry pipeline (PostgreSQL/Clickhouse)
            const dashboardEvent = createEvent({
                category: 'queue_event',
                queueName: topic,
                action: 'submitted',
                channel: 'unified',
                errorMessage: typeof payload === 'object' ? JSON.stringify(payload) : String(payload),
                correlationIds: { traceId: event.id }
            } as any);
            emitDashboardEvent(dashboardEvent as any);

        } catch (e) {
            console.error(`Error en pub/sub para ${topic}:`, e);
            event.retries = (event.retries || 0) + 1;
            this.deadLetterQueue.push(event);
        }
    }

    private processDLQ() {
        if (this.deadLetterQueue.length === 0) return;

        const queueToProcess = [...this.deadLetterQueue];
        this.deadLetterQueue = [];

        for (const event of queueToProcess) {
            if (event.retries && event.retries >= 3) {
                // Permanently failed limit reached -> Emit as dead_lettered
                const failedEvent = createEvent({
                    category: 'queue_event',
                    queueName: event.topic,
                    action: 'dead_lettered',
                    errorMessage: "Max retries exceeded",
                    correlationIds: { traceId: event.id }
                } as any);
                emitDashboardEvent(failedEvent as any);
                console.error(`[EventBus] DLQ permanently failed event: ${event.id}`);
            } else {
                // Attempt to retry
                this.publish(event.topic, event.payload, event);
            }
        }
    }

    subscribe(topic: string, handler: (event: UnifiedEvent) => void) {
        this.on(topic, handler);
        return () => this.off(topic, handler);
    }

    private updateMetrics(topic: string, bytes: number) {
        const baseTopic = topic.split('.')[0] + '.*';
        const current = this.metrics.get(baseTopic) || { count: 0, bytes: 0 };
        current.count += 1;
        current.bytes += bytes;
        this.metrics.set(baseTopic, current);
    }

    getMetrics() {
        return Object.fromEntries(this.metrics);
    }

    stop() {
        clearInterval(this.dlqTimer);
    }
}

export const unifiedEventBus = new UnifiedEventBus();

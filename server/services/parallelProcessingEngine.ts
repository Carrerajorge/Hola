/**
 * Parallel Processing Engine - MICHAT PRO 3.0 (10x Enhanced)
 * 
 * Worker pool for parallel document processing.
 * Streaming results with progress tracking.
 */

import { EventEmitter } from "events";

// ============== Types ==============

export interface ProcessingTask<T = any, R = any> {
    id: string;
    type: TaskType;
    data: T;
    priority: number;
    createdAt: Date;
    timeout?: number;
    callback?: (result: R) => void;
}

export type TaskType =
    | "chunk"
    | "embed"
    | "analyze"
    | "ocr"
    | "vision"
    | "pii"
    | "quality"
    | "custom";

export interface ProcessingResult<R = any> {
    taskId: string;
    success: boolean;
    result?: R;
    error?: string;
    processingTimeMs: number;
    workerId: number;
}

export interface WorkerPoolConfig {
    maxWorkers?: number;
    idleTimeout?: number;
    taskTimeout?: number;
    retryCount?: number;
}

export interface PoolStats {
    activeWorkers: number;
    idleWorkers: number;
    pendingTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgProcessingTime: number;
}

// ============== Worker Simulation ==============
// In production, these would be actual worker threads

interface WorkerState {
    id: number;
    busy: boolean;
    currentTask: string | null;
    completedCount: number;
    totalTime: number;
}

// ============== Processing Functions ==============

type TaskProcessor<T, R> = (data: T) => Promise<R>;

const processors: Record<TaskType, TaskProcessor<any, any>> = {
    chunk: async (data: { text: string; options?: any }) => {
        // Simulate chunking
        const chunks = data.text.match(/.{1,500}/gs) || [];
        await delay(chunks.length * 5);
        return { chunks, count: chunks.length };
    },

    embed: async (data: { texts: string[] }) => {
        // Simulate embedding generation
        await delay(data.texts.length * 10);
        return {
            embeddings: data.texts.map(() =>
                Array(768).fill(0).map(() => Math.random())
            ),
        };
    },

    analyze: async (data: { content: string }) => {
        await delay(50);
        return {
            wordCount: data.content.split(/\s+/).length,
            charCount: data.content.length,
        };
    },

    ocr: async (data: { buffer: Buffer }) => {
        await delay(200);
        return { text: "", confidence: 0 };
    },

    vision: async (data: { image: string }) => {
        await delay(500);
        return { description: "", objects: [] };
    },

    pii: async (data: { text: string }) => {
        await delay(30);
        const emails = data.text.match(/\S+@\S+/g) || [];
        return { detections: emails.length, types: ["email"] };
    },

    quality: async (data: { text: string }) => {
        await delay(20);
        return { score: 0.8, issues: [] };
    },

    custom: async (data: { fn: () => Promise<any> }) => {
        return await data.fn();
    },
};

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== Worker Pool ==============

export class ParallelProcessor extends EventEmitter {
    private workers: WorkerState[] = [];
    private taskQueue: ProcessingTask[] = [];
    private results: Map<string, ProcessingResult> = new Map();
    private config: Required<WorkerPoolConfig>;
    private isRunning = false;
    private completedCount = 0;
    private failedCount = 0;
    private totalProcessingTime = 0;

    constructor(config: WorkerPoolConfig = {}) {
        super();
        this.config = {
            maxWorkers: config.maxWorkers ?? Math.min(8, 4), // CPU cores simulation
            idleTimeout: config.idleTimeout ?? 30000,
            taskTimeout: config.taskTimeout ?? 60000,
            retryCount: config.retryCount ?? 2,
        };

        // Initialize workers
        for (let i = 0; i < this.config.maxWorkers; i++) {
            this.workers.push({
                id: i,
                busy: false,
                currentTask: null,
                completedCount: 0,
                totalTime: 0,
            });
        }
    }

    /**
     * Start the processor
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.processLoop();
        this.emit("started");
    }

    /**
     * Stop the processor
     */
    stop(): void {
        this.isRunning = false;
        this.emit("stopped");
    }

    /**
     * Submit a task
     */
    submit<T, R>(
        type: TaskType,
        data: T,
        options: { priority?: number; timeout?: number } = {}
    ): Promise<R> {
        return new Promise((resolve, reject) => {
            const task: ProcessingTask<T, R> = {
                id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                type,
                data,
                priority: options.priority ?? 5,
                createdAt: new Date(),
                timeout: options.timeout ?? this.config.taskTimeout,
                callback: (result: R) => resolve(result),
            };

            // Insert by priority (higher = first)
            const insertIndex = this.taskQueue.findIndex(t => t.priority < task.priority);
            if (insertIndex === -1) {
                this.taskQueue.push(task);
            } else {
                this.taskQueue.splice(insertIndex, 0, task);
            }

            this.emit("taskSubmitted", task.id);

            // Set timeout
            setTimeout(() => {
                if (!this.results.has(task.id)) {
                    reject(new Error(`Task ${task.id} timed out`));
                }
            }, task.timeout || this.config.taskTimeout);
        });
    }

    /**
     * Submit batch of tasks
     */
    async submitBatch<T, R>(
        type: TaskType,
        items: T[],
        options: { concurrency?: number; priority?: number } = {}
    ): Promise<R[]> {
        const { concurrency = this.config.maxWorkers, priority = 5 } = options;
        const results: R[] = [];

        // Process in batches of concurrency
        for (let i = 0; i < items.length; i += concurrency) {
            const batch = items.slice(i, i + concurrency);
            const batchPromises = batch.map(item =>
                this.submit<T, R>(type, item, { priority })
            );
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            this.emit("batchProgress", {
                completed: Math.min(i + concurrency, items.length),
                total: items.length,
            });
        }

        return results;
    }

    /**
     * Main processing loop
     */
    private async processLoop(): Promise<void> {
        while (this.isRunning) {
            // Find idle worker and pending task
            const idleWorker = this.workers.find(w => !w.busy);
            const nextTask = this.taskQueue.shift();

            if (idleWorker && nextTask) {
                this.processTask(idleWorker, nextTask);
            }

            await delay(10); // Small delay to prevent tight loop
        }
    }

    /**
     * Process a single task
     */
    private async processTask(
        worker: WorkerState,
        task: ProcessingTask
    ): Promise<void> {
        worker.busy = true;
        worker.currentTask = task.id;
        const startTime = Date.now();

        try {
            const processor = processors[task.type];
            if (!processor) {
                throw new Error(`Unknown task type: ${task.type}`);
            }

            const result = await processor(task.data);
            const processingTime = Date.now() - startTime;

            const processingResult: ProcessingResult = {
                taskId: task.id,
                success: true,
                result,
                processingTimeMs: processingTime,
                workerId: worker.id,
            };

            this.results.set(task.id, processingResult);
            this.completedCount++;
            this.totalProcessingTime += processingTime;
            worker.completedCount++;
            worker.totalTime += processingTime;

            if (task.callback) {
                task.callback(result);
            }

            this.emit("taskCompleted", processingResult);
        } catch (error) {
            const processingTime = Date.now() - startTime;

            const processingResult: ProcessingResult = {
                taskId: task.id,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                processingTimeMs: processingTime,
                workerId: worker.id,
            };

            this.results.set(task.id, processingResult);
            this.failedCount++;

            this.emit("taskFailed", processingResult);
        } finally {
            worker.busy = false;
            worker.currentTask = null;
        }
    }

    /**
     * Get pool statistics
     */
    getStats(): PoolStats {
        const activeWorkers = this.workers.filter(w => w.busy).length;

        return {
            activeWorkers,
            idleWorkers: this.workers.length - activeWorkers,
            pendingTasks: this.taskQueue.length,
            completedTasks: this.completedCount,
            failedTasks: this.failedCount,
            avgProcessingTime: this.completedCount > 0
                ? this.totalProcessingTime / this.completedCount
                : 0,
        };
    }

    /**
     * Get task result
     */
    getResult(taskId: string): ProcessingResult | undefined {
        return this.results.get(taskId);
    }

    /**
     * Clear completed results
     */
    clearResults(): void {
        this.results.clear();
    }
}

// ============== Streaming Processor ==============

export class StreamingProcessor extends ParallelProcessor {
    private streamCallbacks: Map<string, (chunk: any) => void> = new Map();

    /**
     * Submit task with streaming results
     */
    submitWithStream<T>(
        type: TaskType,
        data: T,
        onChunk: (chunk: any) => void
    ): Promise<void> {
        const streamId = `stream_${Date.now()}`;
        this.streamCallbacks.set(streamId, onChunk);

        return this.submit(type, { ...data, streamId } as T & { streamId: string }, {})
            .then(() => {
                this.streamCallbacks.delete(streamId);
            });
    }

    /**
     * Emit streaming chunk
     */
    emitChunk(streamId: string, chunk: any): void {
        const callback = this.streamCallbacks.get(streamId);
        if (callback) {
            callback(chunk);
        }
    }
}

// ============== Singleton ==============

let processorInstance: ParallelProcessor | null = null;

export function getParallelProcessor(config?: WorkerPoolConfig): ParallelProcessor {
    if (!processorInstance) {
        processorInstance = new ParallelProcessor(config);
        processorInstance.start();
    }
    return processorInstance;
}

export const parallelProcessingEngine = {
    ParallelProcessor,
    StreamingProcessor,
    getParallelProcessor,
};

export default parallelProcessingEngine;

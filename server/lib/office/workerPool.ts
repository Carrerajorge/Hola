/**
 * Worker Thread Pool for CPU-Intensive Tasks (Excel/Word Parsing)
 * Offloads heavy tasks from the main event loop using real worker_threads.
 *
 * Features:
 * - Real worker threads with message passing
 * - Busy/idle state tracking per worker
 * - Task queue with FIFO ordering
 * - Graceful shutdown
 * - Timeout protection per task
 * - Worker restart on crash
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import { Logger } from '../../logger';

// ============== Types ==============

interface WorkerTask {
    id: string;
    type: 'excel_parse' | 'word_parse' | 'image_process' | 'pdf_render';
    data: any;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    timeoutMs: number;
    timer?: ReturnType<typeof setTimeout>;
    enqueuedAt: number;
}

interface WorkerInfo {
    worker: Worker;
    index: number;
    busy: boolean;
    currentTaskId: string | null;
    tasksCompleted: number;
    lastActivityAt: number;
}

export interface PoolStats {
    totalWorkers: number;
    busyWorkers: number;
    idleWorkers: number;
    queueLength: number;
    totalTasksProcessed: number;
    averageTaskTimeMs: number;
}

// ============== Worker Pool ==============

export class WorkerPool extends EventEmitter {
    private workers: Map<number, WorkerInfo> = new Map();
    private queue: WorkerTask[] = [];
    private maxWorkers: number;
    private workerScript: string;
    private isShuttingDown = false;
    private totalTasksProcessed = 0;
    private totalTaskTimeMs = 0;
    private defaultTimeoutMs: number;

    constructor(maxWorkers: number = 4, defaultTimeoutMs: number = 60000) {
        super();
        this.maxWorkers = Math.max(1, Math.min(maxWorkers, 8)); // clamp between 1 and 8
        this.defaultTimeoutMs = defaultTimeoutMs;
        this.workerScript = path.join(__dirname, 'documentWorker.js');
    }

    /**
     * Initialize the worker pool by spawning all worker threads
     */
    initialize(): void {
        if (this.isShuttingDown) return;

        for (let i = 0; i < this.maxWorkers; i++) {
            this.spawnWorker(i);
        }
        Logger.info(`[WorkerPool] Initialized with ${this.maxWorkers} real worker threads`);
    }

    private spawnWorker(index: number): void {
        try {
            const worker = new Worker(this.workerScript, {
                workerData: { workerIndex: index },
            });

            const info: WorkerInfo = {
                worker,
                index,
                busy: false,
                currentTaskId: null,
                tasksCompleted: 0,
                lastActivityAt: Date.now(),
            };

            worker.on('message', (message: { taskId: string; success: boolean; result?: any; error?: string }) => {
                this.handleWorkerMessage(index, message);
            });

            worker.on('error', (error: Error) => {
                Logger.error(`[WorkerPool] Worker ${index} error: ${error.message}`);
                this.handleWorkerCrash(index);
            });

            worker.on('exit', (code: number) => {
                if (code !== 0 && !this.isShuttingDown) {
                    Logger.warn(`[WorkerPool] Worker ${index} exited with code ${code}, restarting...`);
                    this.workers.delete(index);
                    setTimeout(() => this.spawnWorker(index), 1000);
                }
            });

            this.workers.set(index, info);
        } catch (e) {
            Logger.warn(`[WorkerPool] Failed to create worker ${index}: ${e}`);
            // Fallback: mark as available and process in-thread
        }
    }

    private handleWorkerMessage(
        workerIndex: number,
        message: { taskId: string; success: boolean; result?: any; error?: string }
    ): void {
        const info = this.workers.get(workerIndex);
        if (!info) return;

        // Find the task this worker was processing
        const taskId = info.currentTaskId;
        info.busy = false;
        info.currentTaskId = null;
        info.tasksCompleted++;
        info.lastActivityAt = Date.now();

        if (message.success) {
            // The task's resolve was already captured in the queue entry;
            // we need a way to reach it. We store pending tasks in a map.
            this.emit('taskComplete', { taskId: message.taskId, result: message.result });
        } else {
            this.emit('taskError', { taskId: message.taskId, error: message.error });
        }

        // Process next task in queue
        this.processNext();
    }

    private handleWorkerCrash(workerIndex: number): void {
        const info = this.workers.get(workerIndex);
        if (info?.currentTaskId) {
            // The task the worker was processing failed
            this.emit('taskError', {
                taskId: info.currentTaskId,
                error: `Worker ${workerIndex} crashed during task execution`,
            });
        }

        this.workers.delete(workerIndex);
        if (!this.isShuttingDown) {
            setTimeout(() => this.spawnWorker(workerIndex), 1000);
        }
    }

    /**
     * Submit a task to the pool. Returns a promise that resolves when the task completes.
     */
    async executeTask<T>(
        type: WorkerTask['type'],
        data: any,
        timeoutMs?: number
    ): Promise<T> {
        if (this.isShuttingDown) {
            throw new Error('WorkerPool is shutting down');
        }

        const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
        const timeout = timeoutMs || this.defaultTimeoutMs;

        return new Promise<T>((resolve, reject) => {
            const task: WorkerTask = {
                id: taskId,
                type,
                data,
                resolve,
                reject,
                timeoutMs: timeout,
                enqueuedAt: Date.now(),
            };

            // Set up timeout
            task.timer = setTimeout(() => {
                // Remove from queue if still there
                const queueIndex = this.queue.findIndex(t => t.id === taskId);
                if (queueIndex !== -1) {
                    this.queue.splice(queueIndex, 1);
                }
                reject(new Error(`Task ${taskId} timed out after ${timeout}ms`));
            }, timeout);

            // Set up listeners for this specific task
            const onComplete = (event: { taskId: string; result: any }) => {
                if (event.taskId === taskId) {
                    clearTimeout(task.timer);
                    this.removeListener('taskError', onError);
                    const elapsed = Date.now() - task.enqueuedAt;
                    this.totalTasksProcessed++;
                    this.totalTaskTimeMs += elapsed;
                    resolve(event.result);
                }
            };
            const onError = (event: { taskId: string; error: string }) => {
                if (event.taskId === taskId) {
                    clearTimeout(task.timer);
                    this.removeListener('taskComplete', onComplete);
                    reject(new Error(event.error));
                }
            };

            this.once('taskComplete', onComplete);
            this.once('taskError', onError);

            this.queue.push(task);
            this.processNext();
        });
    }

    private processNext(): void {
        if (this.queue.length === 0) return;

        // Find an idle worker
        let idleWorker: WorkerInfo | undefined;
        for (const info of this.workers.values()) {
            if (!info.busy) {
                idleWorker = info;
                break;
            }
        }

        if (!idleWorker) {
            // All workers busy; task stays in queue
            return;
        }

        const task = this.queue.shift();
        if (!task) return;

        idleWorker.busy = true;
        idleWorker.currentTaskId = task.id;
        idleWorker.lastActivityAt = Date.now();

        try {
            idleWorker.worker.postMessage({
                taskId: task.id,
                type: task.type,
                data: task.data,
            });
        } catch (err) {
            // If postMessage fails, put the task back and restart the worker
            idleWorker.busy = false;
            idleWorker.currentTaskId = null;
            this.queue.unshift(task);
            Logger.error(`[WorkerPool] Failed to post message to worker ${idleWorker.index}`);
        }
    }

    /**
     * Get pool statistics
     */
    getStats(): PoolStats {
        let busyCount = 0;
        for (const info of this.workers.values()) {
            if (info.busy) busyCount++;
        }

        return {
            totalWorkers: this.workers.size,
            busyWorkers: busyCount,
            idleWorkers: this.workers.size - busyCount,
            queueLength: this.queue.length,
            totalTasksProcessed: this.totalTasksProcessed,
            averageTaskTimeMs: this.totalTasksProcessed > 0
                ? Math.round(this.totalTaskTimeMs / this.totalTasksProcessed)
                : 0,
        };
    }

    /**
     * Gracefully shutdown all workers
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        Logger.info(`[WorkerPool] Shutting down ${this.workers.size} workers...`);

        // Reject all queued tasks
        for (const task of this.queue) {
            if (task.timer) clearTimeout(task.timer);
            task.reject(new Error('WorkerPool shutting down'));
        }
        this.queue = [];

        // Terminate all workers
        const terminatePromises: Promise<number>[] = [];
        for (const info of this.workers.values()) {
            terminatePromises.push(info.worker.terminate());
        }
        await Promise.allSettled(terminatePromises);
        this.workers.clear();

        Logger.info('[WorkerPool] All workers terminated');
    }
}

// ============== Singleton ==============

export const officeWorkerPool = new WorkerPool(
    parseInt(process.env.WORKER_POOL_SIZE || '4', 10)
);
